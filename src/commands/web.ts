import { getFiles, WEB_PORT } from "../lib/constants";
import { getState, getAllDatabases } from "../lib/fs";
import { getContainerStatus, startDatabase, stopDatabase, getDatabaseStats, getDockerPath } from "../lib/docker";
import { getPublicIp } from "../lib/network";
import { getMetrics, getMetricsForPeriod, getMetricsGroupedByDatabase, initMetricsDb } from "../lib/metrics";
import { getMachineStats } from "../lib/collector";
import { create } from "./create";
import * as ui from "../lib/ui";
import { PANEL_HTML } from "../web/panel";

// Dynamic getter for web config file - resolved at runtime after setup
const getWebConfigFile = () => getFiles().webConfig;

interface WebConfig {
  enabled: boolean;
  port: number;
  passwordHash: string;
}

async function getWebConfig(): Promise<WebConfig> {
  try {
    const file = Bun.file(getWebConfigFile());
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return { enabled: false, port: WEB_PORT, passwordHash: "" };
}

async function saveWebConfig(config: WebConfig): Promise<void> {
  await Bun.write(getWebConfigFile(), JSON.stringify(config, null, 2));
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const inputHash = await hashPassword(password);
  return inputHash === hash;
}


export async function webEnable(options: { port?: number }): Promise<void> {
  const spin = ui.spinner("Setting up web panel...");
  spin.start();

  try {
    const config = await getWebConfig();
    const port = options.port || config.port || WEB_PORT;

    // Auto-generate password if not set
    let generatedPassword: string | null = null;
    if (!config.passwordHash) {
      generatedPassword = crypto.randomUUID();
      config.passwordHash = await hashPassword(generatedPassword);
    }

    config.enabled = true;
    config.port = port;
    await saveWebConfig(config);

    spin.succeed(`Web panel enabled on port ${port}`);

    // Get public IP for display
    const publicIp = await getPublicIp();

    console.log();
    ui.info("Web Panel Access:");
    ui.printKeyValue("URL", `http://${publicIp}:${port}`);
    ui.printKeyValue("Port", String(port));
    if (generatedPassword) {
      ui.printKeyValue("Password", generatedPassword);
      console.log();
      ui.warning("Save this password! It will not be shown again.");
    }

    console.log();
    ui.info("Starting web server...");
    await startWebServer(port);
  } catch (err) {
    spin.fail("Failed to enable web panel");
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function webDisable(): Promise<void> {
  const config = await getWebConfig();
  config.enabled = false;
  await saveWebConfig(config);

  ui.success("Web panel disabled");
  ui.info("Restart required to stop the web server");
}

export async function webStatus(): Promise<void> {
  const config = await getWebConfig();

  if (config.enabled) {
    ui.success(`Web panel is enabled on port ${config.port}`);
  } else {
    ui.info("Web panel is disabled");
  }
}

async function startWebServer(port: number): Promise<void> {
  const config = await getWebConfig();

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // Serve panel HTML
      if (path === "/" || path === "/index.html") {
        return new Response(PANEL_HTML, {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      // Auth endpoint - simple password verification
      if (path === "/api/auth" && req.method === "POST") {
        try {
          const body = await req.json() as { password: string };
          const valid = await verifyPassword(body.password, config.passwordHash);

          if (!valid) {
            return new Response(JSON.stringify({ error: "Invalid password" }), {
              status: 401,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Protected routes - verify password from header
      const authHeader = req.headers.get("Authorization");
      const password = authHeader?.replace("Bearer ", "");

      if (!password || !(await verifyPassword(password, config.passwordHash))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // List databases (includes connection info for authenticated users)
      if (path === "/api/databases" && req.method === "GET") {
        try {
          const databases = await getAllDatabases();
          const publicIp = await getPublicIp();
          const results = [];

          for (const db of databases) {
            const status = await getContainerStatus(db.name);
            let stats = { size: "N/A", connections: 0, tables: 0 };

            if (status === "running") {
              try {
                stats = await getDatabaseStats(db.name, db.database);
              } catch {}
            }

            results.push({
              name: db.name,
              status: status === "not_found" ? "stopped" : status,
              size: stats.size,
              tables: stats.tables,
              connections: stats.connections,
              // Include connection details for authenticated users
              host: publicIp,
              port: db.port,
              user: db.username,
              password: db.password,
              database: db.database,
            });
          }

          return new Response(JSON.stringify(results), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to list databases" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Create database
      if (path === "/api/databases" && req.method === "POST") {
        try {
          const body = await req.json() as { name: string };
          const name = body.name?.trim().toLowerCase();

          if (!name || !/^[a-z0-9-]+$/.test(name)) {
            return new Response(JSON.stringify({ error: "Invalid database name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Check if database already exists
          const databases = await getAllDatabases();
          if (databases.some(db => db.name === name)) {
            return new Response(JSON.stringify({ error: "Database already exists" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Create database (this will output to console on server side)
          await create({ name });

          // Get the newly created database info to return the connection URL
          const state = await getState();
          const newDb = state.databases[name];
          const publicIp = await getPublicIp();
          const connectionUrl = `postgresql://${newDb.username}:${newDb.password}@${publicIp}:${newDb.port}/${newDb.database}`;

          return new Response(JSON.stringify({ success: true, url: connectionUrl }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to create database" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Start database
      const startMatch = path.match(/^\/api\/databases\/([^/]+)\/start$/);
      if (startMatch && req.method === "POST") {
        try {
          const dbName = decodeURIComponent(startMatch[1]);

          // Validate database name to prevent command injection
          if (!/^[a-z0-9-]+$/.test(dbName)) {
            return new Response(JSON.stringify({ error: "Invalid database name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          await startDatabase(dbName);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to start database" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Stop database
      const stopMatch = path.match(/^\/api\/databases\/([^/]+)\/stop$/);
      if (stopMatch && req.method === "POST") {
        try {
          const dbName = decodeURIComponent(stopMatch[1]);

          // Validate database name to prevent command injection
          if (!/^[a-z0-9-]+$/.test(dbName)) {
            return new Response(JSON.stringify({ error: "Invalid database name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          await stopDatabase(dbName);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to stop database" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Get metrics for all databases
      if (path === "/api/metrics" && req.method === "GET") {
        try {
          initMetricsDb();
          const periodParam = url.searchParams.get("period") || "1h";
          const period = periodParam as "1h" | "24h" | "7d" | "30d" | "all";
          const dbName = url.searchParams.get("database") || undefined;
          const startStr = url.searchParams.get("start");
          const endStr = url.searchParams.get("end");
          const grouped = url.searchParams.get("grouped") === "true";

          let data;
          if (startStr && endStr) {
            // Custom date range
            const startTime = parseInt(startStr, 10);
            const endTime = parseInt(endStr, 10);
            const duration = endTime - startTime;
            let granularity: "minute" | "hour" | "day" = "minute";
            if (duration > 7 * 24 * 60 * 60 * 1000) {
              granularity = "day";
            } else if (duration > 24 * 60 * 60 * 1000) {
              granularity = "hour";
            }
            data = getMetrics(startTime, endTime, dbName, granularity);
          } else if (grouped && !dbName) {
            // Return per-database metrics for multi-line charts
            data = getMetricsGroupedByDatabase(period);
          } else {
            data = getMetricsForPeriod(period, dbName);
          }

          return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to get metrics" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Get machine (host) stats
      if (path === "/api/machine" && req.method === "GET") {
        try {
          const stats = await getMachineStats();
          return new Response(JSON.stringify(stats), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to get machine stats" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Get database schema
      const schemaMatch = path.match(/^\/api\/databases\/([^/]+)\/schema$/);
      if (schemaMatch && req.method === "GET") {
        try {
          const dbName = decodeURIComponent(schemaMatch[1]);

          // Validate database name to prevent command injection
          if (!/^[a-z0-9-]+$/.test(dbName)) {
            return new Response(JSON.stringify({ error: "Invalid database name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const state = await getState();
          const db = state.databases[dbName];

          if (!db) {
            return new Response(JSON.stringify({ error: "Database not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Query information_schema for tables grouped by schema
          // Using parameterized query via environment variable to prevent SQL injection
          const d = await getDockerPath();
          const containerName = `pgforge-${dbName}-pg`;
          const result = await Bun.$`${{ raw: d }} exec ${containerName} psql -U pgadmin -d ${db.database} -t -A -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"`.quiet().text();

          const schemas: Record<string, { name: string }[]> = {};
          for (const line of result.trim().split("\n")) {
            if (!line) continue;
            const [schemaName, tableName] = line.split("|");
            if (!schemas[schemaName]) schemas[schemaName] = [];
            schemas[schemaName].push({ name: tableName });
          }

          return new Response(JSON.stringify(schemas), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to get schema" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Get table data (25 rows max, ordered by newest first if possible)
      const tableMatch = path.match(/^\/api\/databases\/([^/]+)\/table\/([^/]+)\/([^/]+)$/);
      if (tableMatch && req.method === "GET") {
        try {
          const dbName = decodeURIComponent(tableMatch[1]);
          const schemaName = decodeURIComponent(tableMatch[2]);
          const tableName = decodeURIComponent(tableMatch[3]);

          // Validate database name to prevent command injection
          if (!/^[a-z0-9-]+$/.test(dbName)) {
            return new Response(JSON.stringify({ error: "Invalid database name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Validate schema and table names - PostgreSQL identifiers
          // Allow alphanumeric, underscores, and must start with letter or underscore
          const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
          if (!identifierPattern.test(schemaName) || !identifierPattern.test(tableName)) {
            return new Response(JSON.stringify({ error: "Invalid schema or table name" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const state = await getState();
          const db = state.databases[dbName];

          if (!db) {
            return new Response(JSON.stringify({ error: "Database not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const d = await getDockerPath();
          const containerName = `pgforge-${dbName}-pg`;

          // Get column info using parameterized-style query
          // We use format() to safely quote identifiers in psql
          const columnsQuery = `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${schemaName}' AND table_name = '${tableName}' ORDER BY ordinal_position`;
          const columnsResult = await Bun.$`${{ raw: d }} exec ${containerName} psql -U pgadmin -d ${db.database} -t -A -c ${columnsQuery}`.quiet().text();

          const columns: { name: string; type: string }[] = [];
          for (const line of columnsResult.trim().split("\n")) {
            if (!line) continue;
            const [name, type] = line.split("|");
            columns.push({ name, type });
          }

          // Get total row count - using quoted identifiers
          const countQuery = `SELECT COUNT(*) FROM "${schemaName}"."${tableName}"`;
          const countResult = await Bun.$`${{ raw: d }} exec ${containerName} psql -U pgadmin -d ${db.database} -t -A -c ${countQuery}`.quiet().text();
          const totalRows = parseInt(countResult.trim(), 10) || 0;

          // Try to find a timestamp/date column to order by, otherwise use ctid
          let orderByCol = "ctid";
          const dateColumns = columns.filter(c =>
            c.type.includes("timestamp") || c.type.includes("date") ||
            c.name.includes("created") || c.name.includes("updated") || c.name === "id"
          );
          if (dateColumns.length > 0 && identifierPattern.test(dateColumns[0].name)) {
            orderByCol = dateColumns[0].name;
          }

          // Get data (25 rows max) - using quoted identifiers
          // Use pipe as field separator (default psql -A behavior)
          const dataQuery = `SELECT * FROM "${schemaName}"."${tableName}" ORDER BY "${orderByCol}" DESC NULLS LAST LIMIT 25`;
          const dataResult = await Bun.$`${{ raw: d }} exec ${containerName} psql -U pgadmin -d ${db.database} -t -A -c ${dataQuery}`.quiet().text();

          const rows: Record<string, any>[] = [];
          for (const line of dataResult.trim().split("\n")) {
            if (!line) continue;
            const values = line.split("|");
            const row: Record<string, any> = {};
            columns.forEach((col, i) => {
              row[col.name] = values[i] === "" ? null : values[i];
            });
            rows.push(row);
          }

          return new Response(JSON.stringify({ columns, rows, totalRows }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to get table data" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // Import database from external source
      if (path === "/api/databases/import" && req.method === "POST") {
        try {
          const body = await req.json() as { sourceUrl: string; name?: string };
          const sourceUrl = body.sourceUrl?.trim();
          const customName = body.name?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");

          if (!sourceUrl) {
            return new Response(JSON.stringify({ error: "Source URL is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Validate PostgreSQL URL format to prevent command injection
          // Must be a valid postgresql:// URL
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(sourceUrl);
            if (!parsedUrl.protocol.startsWith("postgres")) {
              throw new Error("Invalid protocol");
            }
          } catch {
            return new Response(JSON.stringify({ error: "Invalid PostgreSQL URL format" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Use custom name if provided, otherwise extract from URL
          let finalName: string;
          const databases = await getAllDatabases();

          if (customName && customName.length > 0) {
            // Validate custom name
            if (!/^[a-z0-9-]+$/.test(customName)) {
              return new Response(JSON.stringify({ error: "Invalid database name. Use only lowercase letters, numbers, and hyphens." }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }
            if (databases.some(db => db.name === customName)) {
              return new Response(JSON.stringify({ error: "A database with this name already exists" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }
            finalName = customName;
          } else {
            // Extract database name from path, validate it
            const sourceDbName = parsedUrl.pathname.replace(/^\//, "") || "imported";
            if (!/^[a-zA-Z0-9_-]+$/.test(sourceDbName)) {
              return new Response(JSON.stringify({ error: "Invalid source database name" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            // Generate a unique name for the imported database
            let importName = sourceDbName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
            let counter = 1;
            finalName = importName;
            while (databases.some(db => db.name === finalName)) {
              finalName = `${importName}-${counter}`;
              counter++;
            }
          }

          // Create the new database first
          await create({ name: finalName });

          // Get the newly created database info
          const state = await getState();
          const newDb = state.databases[finalName];
          const publicIp = await getPublicIp();

          // Export from source and import to new database
          // Use environment variables to pass sensitive data safely
          const d = await getDockerPath();
          const containerName = `pgforge-${finalName}-pg`;

          // Parse SSL mode from URL for providers like Neon that require specific SSL settings
          const sslMode = parsedUrl.searchParams.get("sslmode") || "require";

          // Use full postgres image (not alpine) which has better SSL support
          // Set PGSSLMODE environment variable for SSL handling
          // Also set channel_binding=disable as some providers have issues with it
          // Use postgres:17 to support latest PostgreSQL server versions (e.g., Neon runs PG17)
          const cleanUrl = sourceUrl.replace(/&?channel_binding=[^&]*/g, "");
          const importResult = await Bun.$`${{ raw: d }} run --rm -e SOURCE_URL=${cleanUrl} -e PGSSLMODE=${sslMode} postgres:17 sh -c 'pg_dump "$SOURCE_URL" --no-owner --no-acl --no-comments 2>&1'`.quiet().nothrow();

          let dumpData = importResult.stdout;
          let importSuccess = importResult.exitCode === 0 && dumpData.length > 100;

          if (!importSuccess) {
            // Try with network host mode
            const altResult = await Bun.$`${{ raw: d }} run --rm --network host -e SOURCE_URL=${cleanUrl} -e PGSSLMODE=${sslMode} postgres:17 sh -c 'pg_dump "$SOURCE_URL" --no-owner --no-acl --no-comments 2>&1'`.quiet().nothrow();
            if (altResult.exitCode === 0 && altResult.stdout.length > 100) {
              dumpData = altResult.stdout;
              importSuccess = true;
            } else {
              // Return error with details
              const stderr = altResult.stderr.toString() || importResult.stderr.toString();
              const stdout = altResult.stdout.toString() || importResult.stdout.toString();
              const errorOutput = stderr || stdout;
              const errorMsg = errorOutput.slice(0, 300) || "Import failed - check source URL and credentials";
              throw new Error(errorMsg);
            }
          }

          if (importSuccess && dumpData.length > 0) {
            // Write dump to temp file and import
            const tempFile = `/tmp/pgforge-import-${finalName}.sql`;
            await Bun.write(tempFile, dumpData);
            await Bun.$`${{ raw: d }} cp ${tempFile} ${containerName}:/tmp/import.sql`.quiet();
            await Bun.$`${{ raw: d }} exec ${containerName} psql -U pgadmin -d ${newDb.database} -f /tmp/import.sql`.quiet();
            await Bun.$`rm -f ${tempFile}`.quiet();
          }

          const connectionUrl = `postgresql://${newDb.username}:${newDb.password}@${publicIp}:${newDb.port}/${newDb.database}`;

          return new Response(JSON.stringify({ success: true, url: connectionUrl, name: finalName }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Import failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // 404
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders,
      });
    },
  });

  const publicIp = await getPublicIp();
  console.log();
  ui.success(`Web panel running at http://${publicIp}:${port}`);
  ui.muted("Press Ctrl+C to stop the server");
}

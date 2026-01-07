import { getFiles, WEB_PORT } from "../lib/constants";
import { getState, getAllDatabases } from "../lib/fs";
import { getContainerStatus, startDatabase, stopDatabase, getDatabaseStats, getDockerPath } from "../lib/docker";
import { getPublicIp } from "../lib/network";
import { getMetrics, getMetricsForPeriod, getMetricsGroupedByDatabase, initMetricsDb } from "../lib/metrics";
import { getMachineStats } from "../lib/collector";
import { create } from "./create";
import * as ui from "../lib/ui";
import {
  getS3Config,
  saveS3Config,
  deleteS3Config,
  parseS3Url,
  formatS3Url,
  testS3Connection,
  listS3Backups,
  runScheduledBackup,
  createDatabaseBackup,
  uploadBackupToS3,
  type S3Config,
} from "../lib/s3";
import { PANEL_HTML } from "../web/panel";

// Dynamic getter for web config file - resolved at runtime after setup
const getWebConfigFile = () => getFiles().webConfig;
const getWebPidFile = () => getFiles().webPid;

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


export async function webEnable(options: { port?: number; public?: boolean }): Promise<void> {
  const spin = ui.spinner("Setting up web panel...");
  spin.start();

  try {
    const config = await getWebConfig();
    const port = options.port || config.port || WEB_PORT;
    const isPublic = options.public || false;

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
    const bindHost = isPublic ? "0.0.0.0" : "127.0.0.1";
    const displayHost = isPublic ? publicIp : "127.0.0.1";

    console.log();
    ui.info("Starting web server...");

    if (!isPublic) {
      ui.muted("Running on 127.0.0.1 interface. Use --public to bind to 0.0.0.0");
      console.log();
    }

    await startWebServer(port, bindHost, displayHost, generatedPassword);
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

  // Try to stop the running web server process
  const pidFile = getWebPidFile();
  try {
    const file = Bun.file(pidFile);
    if (await file.exists()) {
      const pidContent = await file.text();
      const pid = parseInt(pidContent.trim(), 10);
      if (!isNaN(pid)) {
        // Check if process is running
        const checkResult = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
        if (checkResult.exitCode === 0) {
          // Process is running, kill it
          await Bun.$`kill -TERM ${pid}`.quiet().nothrow();
          // Wait a moment and force kill if needed
          await Bun.sleep(500);
          const stillRunning = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
          if (stillRunning.exitCode === 0) {
            await Bun.$`kill -KILL ${pid}`.quiet().nothrow();
          }
          ui.success("Web panel stopped");
        } else {
          ui.success("Web panel disabled");
        }
      }
      // Clean up PID file
      await Bun.$`rm -f ${pidFile}`.quiet().nothrow();
    } else {
      ui.success("Web panel disabled");
    }
  } catch {
    ui.success("Web panel disabled");
  }
}

export async function webStatus(): Promise<void> {
  const config = await getWebConfig();

  if (config.enabled) {
    ui.success(`Web panel is enabled on port ${config.port}`);
  } else {
    ui.info("Web panel is disabled");
  }
}

async function startWebServer(port: number, hostname: string, displayHost: string, generatedPassword: string | null): Promise<void> {
  const config = await getWebConfig();

  // Write PID file so we can stop the server later
  await Bun.write(getWebPidFile(), String(process.pid));

  // Clean up PID file on exit
  const cleanup = () => {
    Bun.$`rm -f ${getWebPidFile()}`.quiet().nothrow();
  };
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  Bun.serve({
    port,
    hostname,
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

      // S3 Backup Configuration - GET status
      if (path === "/api/s3" && req.method === "GET") {
        try {
          const s3Config = await getS3Config();
          if (!s3Config) {
            return new Response(JSON.stringify({ configured: false }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          // Test connection
          const connTest = await testS3Connection(s3Config);

          return new Response(JSON.stringify({
            configured: true,
            enabled: s3Config.enabled,
            endpoint: s3Config.endpoint,
            bucket: s3Config.bucket,
            region: s3Config.region,
            intervalHours: s3Config.intervalHours,
            lastBackup: s3Config.lastBackup,
            connectionHealthy: connTest.success,
            connectionError: connTest.error,
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to get S3 config" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // S3 Backup Configuration - POST configure
      if (path === "/api/s3" && req.method === "POST") {
        try {
          const body = await req.json() as {
            url?: string;
            enabled?: boolean;
            intervalHours?: number;
          };

          if (body.url) {
            // Configure new S3 connection
            const parsed = parseS3Url(body.url);
            const newConfig: S3Config = {
              ...parsed,
              enabled: body.enabled !== false,
              intervalHours: body.intervalHours || 24,
              lastBackup: null,
            };

            // Test connection before saving
            const connTest = await testS3Connection(newConfig);
            if (!connTest.success) {
              return new Response(JSON.stringify({ error: connTest.error || "Connection test failed" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            await saveS3Config(newConfig);
            return new Response(JSON.stringify({ success: true }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } else {
            // Update existing config (enable/disable, interval)
            const existing = await getS3Config();
            if (!existing) {
              return new Response(JSON.stringify({ error: "S3 not configured" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            if (body.enabled !== undefined) existing.enabled = body.enabled;
            if (body.intervalHours !== undefined) existing.intervalHours = body.intervalHours;

            await saveS3Config(existing);
            return new Response(JSON.stringify({ success: true }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Failed to configure S3" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // S3 Backup Configuration - DELETE remove
      if (path === "/api/s3" && req.method === "DELETE") {
        try {
          await deleteS3Config();
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to remove S3 config" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // S3 List backups
      if (path === "/api/s3/backups" && req.method === "GET") {
        try {
          const s3Config = await getS3Config();
          if (!s3Config) {
            return new Response(JSON.stringify({ error: "S3 not configured" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const dbName = url.searchParams.get("database") || undefined;
          const result = await listS3Backups(s3Config, dbName);

          if (!result.success) {
            return new Response(JSON.stringify({ error: result.error }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          return new Response(JSON.stringify(result.backups), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to list backups" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // S3 Run manual backup
      if (path === "/api/s3/backup" && req.method === "POST") {
        try {
          const s3Config = await getS3Config();
          if (!s3Config) {
            return new Response(JSON.stringify({ error: "S3 not configured" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const body = await req.json() as { database?: string };
          const dbName = body.database;

          if (dbName) {
            // Backup single database
            const backupResult = await createDatabaseBackup(dbName);
            if (!backupResult.success || !backupResult.data) {
              return new Response(JSON.stringify({ error: backupResult.error || "Backup failed" }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            const uploadResult = await uploadBackupToS3(s3Config, dbName, backupResult.data);
            if (!uploadResult.success) {
              return new Response(JSON.stringify({ error: uploadResult.error || "Upload failed" }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            // Update last backup time
            s3Config.lastBackup = new Date().toISOString();
            await saveS3Config(s3Config);

            return new Response(JSON.stringify({ success: true, key: uploadResult.key }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } else {
            // Backup all databases
            const result = await runScheduledBackup();
            return new Response(JSON.stringify(result), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: "Backup failed" }), {
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

  // Display the web panel URL
  console.log();
  ui.printSectionBox("Web Panel", [
    { label: "URL", value: `http://${displayHost}:${port}`, color: "highlight" },
  ]);

  if (generatedPassword) {
    ui.printSectionBox("Access", [
      { label: "Password", value: generatedPassword, color: "warning" },
    ], "🔑");
  }

  console.log();
  console.log(ui.brand.muted("Press Ctrl+C to stop"));
  console.log();
}

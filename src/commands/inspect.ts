import { getState, getConfig, getDatabasePath } from "../lib/fs";
import { getContainerStatus, getDatabaseStats, getContainerLogs } from "../lib/docker";
import { buildConnectionUrl } from "../lib/network";
import * as ui from "../lib/ui";

interface InspectOptions {
  name?: string;
  logs?: boolean;
}

export async function inspect(options: InspectOptions): Promise<void> {
  const state = await getState();
  const config = await getConfig();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    return;
  }

  // Select database
  let dbName: string;

  if (options.name) {
    if (!state.databases[options.name]) {
      ui.error(`Database "${options.name}" not found.`);
      ui.info("Use 'pgforge list' to see all databases.");
      process.exit(1);
    }
    dbName = options.name;
  } else {
    if (databases.length === 1) {
      dbName = databases[0].name;
    } else {
      dbName = await ui.select(
        "Which database do you want to inspect?",
        databases.map((db) => ({
          name: `${db.name} (${db.status})`,
          value: db.name,
        }))
      );
    }
  }

  const db = state.databases[dbName];
  const status = await getContainerStatus(dbName);
  const publicIp = config.publicIp || "localhost";
  const dbPath = getDatabasePath(dbName);

  const url = buildConnectionUrl({
    host: publicIp,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
  });

  console.log();

  // Header
  ui.printSection(`Database: ${dbName}`);
  console.log();

  // Status
  ui.printKeyValue("Status", ui.formatStatus(status));
  ui.printKeyValue("Created", new Date(db.createdAt).toLocaleString());
  if (db.stoppedAt) {
    ui.printKeyValue("Stopped", new Date(db.stoppedAt).toLocaleString());
  }

  console.log();
  ui.printSection("Connection");
  ui.printKeyValue("Host", publicIp);
  ui.printKeyValue("Port", db.port.toString());
  ui.printKeyValue("Username", db.username);
  ui.printKeyValue("Password", db.password);
  ui.printKeyValue("Database", db.database);
  ui.printKeyValue("Pooler", db.poolerEnabled ? "Enabled (PgBouncer)" : "Disabled");

  // Connection URL
  ui.printConnectionUrl(url);

  // Get stats if running
  if (status === "running") {
    console.log();
    ui.printSection("Statistics");

    const spin = ui.spinner("Fetching stats...");
    spin.start();

    try {
      const stats = await getDatabaseStats(dbName, db.database);
      spin.stop();

      ui.printKeyValue("Size", stats.size);
      ui.printKeyValue("Tables", stats.tables.toString());
      ui.printKeyValue("Connections", stats.connections.toString());
    } catch {
      spin.stop();
      ui.muted("  Could not fetch statistics");
    }
  }

  // Paths
  console.log();
  ui.printSection("Paths");
  ui.printKeyValue("Data", `${dbPath}/data`);
  ui.printKeyValue("Backups", `${dbPath}/backups`);
  ui.printKeyValue("Compose", `${dbPath}/docker-compose.yml`);

  // Docker info
  console.log();
  ui.printSection("Docker");
  ui.printKeyValue("PostgreSQL", `pgforge-${dbName}-pg`);
  if (db.poolerEnabled) {
    ui.printKeyValue("PgBouncer", `pgforge-${dbName}-bouncer`);
  }
  ui.printKeyValue("Network", `pgforge-${dbName}-internal`);
  ui.printKeyValue("PG Version", db.pgVersion);

  // Show logs if requested
  if (options.logs) {
    console.log();
    ui.printSection("Recent Logs");
    console.log();

    const logs = await getContainerLogs(dbName, 20);
    if (logs.trim()) {
      console.log(ui.brand.muted(logs));
    } else {
      ui.muted("  No logs available");
    }
  }

  console.log();
}

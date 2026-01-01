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

  // Status section
  const statusIcon = status === "running" ? "🟢" : "🔴";
  const statusItems = [
    { label: "Status", value: status, color: status === "running" ? "success" : "warning" as const },
    { label: "Created", value: new Date(db.createdAt).toLocaleString(), color: "muted" as const },
  ];

  if (db.stoppedAt) {
    statusItems.push({ label: "Stopped", value: new Date(db.stoppedAt).toLocaleString(), color: "muted" as const });
  }

  ui.printSectionBox(`Database: ${dbName}`, statusItems, statusIcon);

  // Connection details
  ui.printSectionBox("Connection Details", [
    { label: "Host", value: publicIp, color: "white" },
    { label: "Port", value: db.port.toString(), color: "white" },
    { label: "Username", value: db.username, color: "white" },
    { label: "Password", value: db.password, color: "warning" },
    { label: "Database", value: db.database, color: "white" },
    { label: "Pooler", value: db.poolerEnabled ? "Enabled (PgBouncer)" : "Disabled", color: "muted" },
  ], "🔌");

  // Connection URL
  ui.printSectionBox("Connection URL", [
    { label: "PostgreSQL", value: url, color: "highlight" },
  ]);

  // Get stats if running
  if (status === "running") {
    const spin = ui.spinner("Fetching stats...");
    spin.start();

    try {
      const stats = await getDatabaseStats(dbName, db.database);
      spin.stop();

      ui.printSectionBox("Statistics", [
        { label: "Size", value: stats.size, color: "white" },
        { label: "Tables", value: stats.tables.toString(), color: "white" },
        { label: "Connections", value: stats.connections.toString(), color: "white" },
      ], "📊");
    } catch {
      spin.stop();
      console.log();
      ui.muted("Could not fetch statistics");
    }
  }

  // Paths
  ui.printSectionBox("Paths", [
    { label: "Data", value: `${dbPath}/data`, color: "muted" },
    { label: "Backups", value: `${dbPath}/backups`, color: "muted" },
    { label: "Compose", value: `${dbPath}/docker-compose.yml`, color: "muted" },
  ], "📁");

  // Docker info
  const dockerItems = [
    { label: "PostgreSQL", value: `pgforge-${dbName}-pg`, color: "muted" as const },
  ];

  if (db.poolerEnabled) {
    dockerItems.push({ label: "PgBouncer", value: `pgforge-${dbName}-bouncer`, color: "muted" as const });
  }

  dockerItems.push(
    { label: "Network", value: `pgforge-${dbName}-internal`, color: "muted" as const },
    { label: "PG Version", value: db.pgVersion, color: "muted" as const }
  );

  ui.printSectionBox("Docker", dockerItems, "🐳");

  // Show logs if requested
  if (options.logs) {
    console.log();
    ui.printSection("Recent Logs (last 20 lines)");
    console.log();

    const logs = await getContainerLogs(dbName, 20);
    if (logs.trim()) {
      console.log(ui.brand.muted(logs));
    } else {
      ui.muted("No logs available");
    }
    console.log();
  }

  console.log();
}

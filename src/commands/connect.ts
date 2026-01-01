import { getState, getConfig } from "../lib/fs";
import { getContainerStatus } from "../lib/docker";
import { buildConnectionUrl } from "../lib/network";
import * as ui from "../lib/ui";

export async function connect(): Promise<void> {
  const state = await getState();
  const config = await getConfig();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    console.log();
    ui.muted("Create one with: pgforge create --name myapp");
    return;
  }

  const publicIp = config.publicIp || "localhost";

  // Update statuses
  const spin = ui.spinner("Checking database statuses...");
  spin.start();

  for (const db of databases) {
    const status = await getContainerStatus(db.name);
    if (status !== "not_found") {
      db.status = status;
    }
  }

  spin.stop();

  // Display each database with its own section box
  for (const db of databases) {
    const url = buildConnectionUrl({
      host: publicIp,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
    });

    const statusIcon = db.status === "running" ? "🟢" : "🔴";

    ui.printSectionBox(`${db.name}`, [
      { label: "Status", value: db.status, color: db.status === "running" ? "success" : "warning" },
      { label: "Host", value: publicIp, color: "white" },
      { label: "Port", value: db.port.toString(), color: "white" },
      { label: "Username", value: db.username, color: "white" },
      { label: "Password", value: db.password, color: "warning" },
      { label: "Database", value: db.database, color: "white" },
    ], statusIcon);

    ui.printSectionBox("Connection URL", [
      { label: "PostgreSQL", value: url, color: "highlight" },
    ]);
  }

  // Usage examples
  console.log();
  ui.printSection("Usage Examples");
  console.log();

  const firstDb = databases[0];
  const firstUrl = buildConnectionUrl({
    host: publicIp,
    port: firstDb.port,
    username: firstDb.username,
    password: firstDb.password,
    database: firstDb.database,
  });

  ui.muted("  # Connect with psql");
  console.log(`  ${ui.brand.highlight(`psql "${firstUrl}"`)}`);
  console.log();

  ui.muted("  # Set as environment variable");
  console.log(`  ${ui.brand.highlight(`export DATABASE_URL="${firstUrl}"`)}`);
  console.log();

  ui.muted("  # In your .env file");
  console.log(`  ${ui.brand.highlight(`DATABASE_URL=${firstUrl}`)}`);
  console.log();
}

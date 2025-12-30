import Table from "cli-table3";
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

  console.log();
  ui.printSection("Database Connections");
  console.log();

  // Create detailed table
  const table = new Table({
    head: [
      ui.brand.primary("Name"),
      ui.brand.primary("Status"),
      ui.brand.primary("Port"),
      ui.brand.primary("Username"),
      ui.brand.primary("Password"),
    ],
    style: {
      head: [],
      border: ["gray"],
    },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    wordWrap: true,
  });

  for (const db of databases) {
    table.push([
      ui.brand.primary(db.name),
      ui.formatStatus(db.status),
      db.port.toString(),
      db.username,
      db.password,
    ]);
  }

  console.log(table.toString());
  console.log();

  // Print connection URLs
  ui.printSection("Connection URLs");
  console.log();

  for (const db of databases) {
    const url = buildConnectionUrl({
      host: publicIp,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
    });

    const statusIcon = db.status === "running" ? ui.brand.success("●") : ui.brand.warning("○");
    console.log(`${statusIcon} ${ui.brand.primary(db.name)}`);
    console.log(`  ${ui.brand.highlight(url)}`);
    console.log();
  }

  // Usage examples
  ui.printDivider();
  console.log();
  ui.printSection("Quick Copy");
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
  console.log(`  psql "${firstUrl}"`);
  console.log();

  ui.muted("  # Set as environment variable");
  console.log(`  export DATABASE_URL="${firstUrl}"`);
  console.log();

  ui.muted("  # In your .env file");
  console.log(`  DATABASE_URL=${firstUrl}`);
  console.log();
}

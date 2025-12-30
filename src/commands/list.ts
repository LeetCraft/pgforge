import { getState } from "../lib/fs";
import { getContainerStatus } from "../lib/docker";
import { getPortSummary } from "../lib/ports";
import * as ui from "../lib/ui";

export async function list(): Promise<void> {
  const state = await getState();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    console.log();
    ui.muted("Create one with: pgforge create --name myapp");
    return;
  }

  // Update statuses from Docker
  const spin = ui.spinner("Checking database statuses...");
  spin.start();

  for (const db of databases) {
    const status = await getContainerStatus(db.name);
    if (status !== "not_found") {
      db.status = status;
    }
  }

  spin.stop();

  // Create table
  const table = ui.createDatabaseTable();

  for (const db of databases) {
    table.push([
      ui.brand.primary(db.name),
      ui.formatStatus(db.status),
      db.port.toString(),
      ui.formatRelativeTime(db.createdAt),
    ]);
  }

  console.log();
  console.log(table.toString());
  console.log();

  // Port summary
  const portSummary = await getPortSummary();
  ui.muted(
    `${databases.length} database(s) | ` +
    `${portSummary.used}/${portSummary.total} ports used | ` +
    `${portSummary.available} available`
  );
}

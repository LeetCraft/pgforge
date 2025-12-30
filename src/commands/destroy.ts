import { getState, saveState, getDatabasePath } from "../lib/fs";
import { destroyDatabase } from "../lib/docker";
import * as ui from "../lib/ui";

interface DestroyOptions {
  name?: string;
  force?: boolean;
}

export async function destroy(options: DestroyOptions): Promise<void> {
  const state = await getState();
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
        "Which database do you want to destroy?",
        databases.map((db) => ({
          name: `${db.name} (${db.status}, port ${db.port})`,
          value: db.name,
        }))
      );
    }
  }

  const db = state.databases[dbName];
  const dbPath = getDatabasePath(dbName);

  // Confirm destruction
  if (!options.force) {
    console.log();
    ui.warning("This will permanently delete:");
    ui.printKeyValue("Database", dbName);
    ui.printKeyValue("Data directory", `${dbPath}/data`);
    ui.printKeyValue("All backups", `${dbPath}/backups`);
    console.log();
    ui.error("THIS ACTION CANNOT BE UNDONE!");
    console.log();

    const confirmed = await ui.confirm(`Type 'yes' to destroy "${dbName}" forever`);
    if (!confirmed) {
      ui.info("Destruction cancelled.");
      return;
    }
  }

  // Stop and remove containers
  const containerSpin = ui.spinner("Stopping containers...");
  containerSpin.start();

  try {
    await destroyDatabase(dbName);
    containerSpin.succeed("Containers removed");
  } catch (err) {
    containerSpin.fail("Failed to remove containers");
    ui.warning("Containers may have already been removed.");
  }

  // Remove data directory
  const dataSpin = ui.spinner("Removing data files...");
  dataSpin.start();

  try {
    await Bun.$`rm -rf ${dbPath}`.quiet();
    dataSpin.succeed("Data files removed");
  } catch (err) {
    dataSpin.fail("Failed to remove data files");
    ui.warning(`You may need to manually delete: ${dbPath}`);
  }

  // Remove from state (but keep port allocation for consistency)
  delete state.databases[dbName];
  await saveState(state);

  console.log();
  ui.success(`Database "${dbName}" has been destroyed.`);
  ui.muted("The port allocation has been preserved for potential recreation.");
}

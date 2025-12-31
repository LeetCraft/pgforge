import { getState, saveState, getAllDatabases, getDatabasePath } from "../lib/fs";
import { getContainerStatus, stopDatabase, startDatabase, getDockerPath } from "../lib/docker";
import * as ui from "../lib/ui";
import * as readline from "readline";

interface RenameOptions {
  from?: string;
  to?: string;
  force?: boolean;
}

async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function rename(options: RenameOptions): Promise<void> {
  const state = await getState();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.error("No databases found");
    process.exit(1);
  }

  // Get database name
  let fromName = options.from;
  let toName = options.to;

  if (!fromName) {
    if (databases.length === 1) {
      fromName = databases[0].name;
    } else {
      fromName = await ui.select(
        "Which database do you want to rename?",
        databases.map((db) => ({
          name: `${db.name} (${db.status}, port ${db.port})`,
          value: db.name,
        }))
      );
    }
  }

  if (!toName) {
    toName = await promptInput("New name: ");
  }

  // Validate names
  if (!fromName || !toName) {
    ui.error("Both source and target names are required");
    process.exit(1);
  }

  // Sanitize new name
  const sanitizedName = toName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (sanitizedName !== toName) {
    ui.info(`Name sanitized to: ${sanitizedName}`);
    toName = sanitizedName;
  }

  if (fromName === toName) {
    ui.error("New name must be different from current name");
    process.exit(1);
  }

  // Check source exists
  const sourceDb = state.databases[fromName];
  if (!sourceDb) {
    ui.error(`Database "${fromName}" not found`);
    process.exit(1);
  }

  // Check target doesn't exist
  if (state.databases[toName]) {
    ui.error(`Database "${toName}" already exists`);
    process.exit(1);
  }

  // Confirm rename
  if (!options.force) {
    const confirm = await promptInput(`Rename "${fromName}" to "${toName}"? This will restart the database. (y/N): `);
    if (confirm.toLowerCase() !== "y") {
      ui.info("Cancelled");
      process.exit(0);
    }
  }

  const spin = ui.spinner(`Renaming ${fromName} to ${toName}...`);
  spin.start();

  try {
    const dockerPath = await getDockerPath();
    const wasRunning = await getContainerStatus(fromName) === "running";

    // Stop database if running
    if (wasRunning) {
      spin.text = "Stopping database...";
      await stopDatabase(fromName);
    }

    // Rename directory
    spin.text = "Renaming database directory...";
    const oldDir = getDatabasePath(fromName);
    const newDir = getDatabasePath(toName);
    await Bun.$`mv ${oldDir} ${newDir}`.quiet();

    // Update docker-compose.yml with new container names
    spin.text = "Updating configuration...";
    const composeFile = `${newDir}/docker-compose.yml`;
    let composeContent = await Bun.file(composeFile).text();

    // Replace old name references with new name
    composeContent = composeContent.replace(new RegExp(`pgforge-${fromName}`, "g"), `pgforge-${toName}`);
    await Bun.write(composeFile, composeContent);

    // Update state
    spin.text = "Updating state...";
    const updatedDb = { ...sourceDb, name: toName };
    delete state.databases[fromName];
    state.databases[toName] = updatedDb;
    await saveState(state);

    // Start database if it was running
    if (wasRunning) {
      spin.text = "Starting database...";
      await startDatabase(toName);
    }

    spin.succeed(`Renamed "${fromName}" to "${toName}"`);

    // Show new connection info
    const publicIp = (await Bun.$`curl -s ifconfig.me`.quiet().text()).trim() || "localhost";
    const url = `postgresql://${updatedDb.username}:${updatedDb.password}@${publicIp}:${updatedDb.port}/${updatedDb.database}`;

    console.log();
    ui.info("Connection URL (unchanged):");
    console.log(`  ${url}`);
    console.log();
    ui.muted("Note: The connection URL remains the same - only the display name changed.");

  } catch (err) {
    spin.fail("Failed to rename database");
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

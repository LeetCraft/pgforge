import { getState, saveState } from "../lib/fs";
import { stopDatabase, getContainerStatus } from "../lib/docker";
import * as ui from "../lib/ui";

interface StopOptions {
  name?: string;
  all?: boolean;
}

export async function stop(options: StopOptions): Promise<void> {
  const state = await getState();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    return;
  }

  let toStop: string[] = [];

  if (options.all) {
    toStop = databases.map((db) => db.name);
  } else if (options.name) {
    if (!state.databases[options.name]) {
      ui.error(`Database "${options.name}" not found.`);
      ui.info("Use 'pgforge list' to see all databases.");
      process.exit(1);
    }
    toStop = [options.name];
  } else {
    // Interactive selection
    const runningDbs = databases.filter((db) => db.status === "running");

    if (runningDbs.length === 0) {
      ui.info("No running databases found.");
      return;
    }

    if (runningDbs.length === 1) {
      toStop = [runningDbs[0].name];
    } else {
      const selected = await ui.select(
        "Which database do you want to stop?",
        runningDbs.map((db) => ({
          name: `${db.name} (port ${db.port})`,
          value: db.name,
        }))
      );
      toStop = [selected];
    }
  }

  // Stop databases
  for (const name of toStop) {
    const spin = ui.spinner(`Stopping ${name}...`);
    spin.start();

    try {
      await stopDatabase(name);

      // Update state
      if (state.databases[name]) {
        state.databases[name].status = "stopped";
        state.databases[name].stoppedAt = new Date().toISOString();
      }

      spin.succeed(`${name} stopped`);
    } catch (err) {
      spin.fail(`Failed to stop ${name}`);
      ui.error(err instanceof Error ? err.message : String(err));
    }
  }

  await saveState(state);

  console.log();
  ui.success(`Stopped ${toStop.length} database(s)`);
  ui.muted("Use 'pgforge start --name <name>' to restart.");
}

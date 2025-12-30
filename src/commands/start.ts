import { getState, saveState, getConfig } from "../lib/fs";
import { startDatabase, getContainerStatus } from "../lib/docker";
import { buildConnectionUrl } from "../lib/network";
import * as ui from "../lib/ui";

interface StartOptions {
  name?: string;
  all?: boolean;
}

export async function start(options: StartOptions): Promise<void> {
  const state = await getState();
  const config = await getConfig();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    ui.muted("Create one with: pgforge create --name myapp");
    return;
  }

  let toStart: string[] = [];

  if (options.all) {
    toStart = databases.filter((db) => db.status === "stopped").map((db) => db.name);
  } else if (options.name) {
    if (!state.databases[options.name]) {
      ui.error(`Database "${options.name}" not found.`);
      ui.info("Use 'pgforge list' to see all databases.");
      process.exit(1);
    }
    toStart = [options.name];
  } else {
    // Interactive selection
    const stoppedDbs = databases.filter((db) => db.status === "stopped");

    if (stoppedDbs.length === 0) {
      ui.info("All databases are already running.");
      return;
    }

    if (stoppedDbs.length === 1) {
      toStart = [stoppedDbs[0].name];
    } else {
      const selected = await ui.select(
        "Which database do you want to start?",
        stoppedDbs.map((db) => ({
          name: `${db.name} (port ${db.port})`,
          value: db.name,
        }))
      );
      toStart = [selected];
    }
  }

  if (toStart.length === 0) {
    ui.info("No stopped databases to start.");
    return;
  }

  const publicIp = config.publicIp || "localhost";

  // Start databases
  for (const name of toStart) {
    const spin = ui.spinner(`Starting ${name}...`);
    spin.start();

    try {
      await startDatabase(name);

      // Wait for healthy status
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        const status = await getContainerStatus(name);
        if (status === "running") {
          break;
        }
        if (status === "error") {
          throw new Error("Container failed to start");
        }
        await Bun.sleep(1000);
        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error("Timeout waiting for container");
      }

      // Update state
      if (state.databases[name]) {
        state.databases[name].status = "running";
        delete state.databases[name].stoppedAt;
      }

      spin.succeed(`${name} started`);

      // Print connection URL
      const db = state.databases[name];
      const url = buildConnectionUrl({
        host: publicIp,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.database,
      });

      ui.printConnectionUrl(url, name);
    } catch (err) {
      spin.fail(`Failed to start ${name}`);
      ui.error(err instanceof Error ? err.message : String(err));
    }
  }

  await saveState(state);
}

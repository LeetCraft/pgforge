import { ensureDirectories, ensureDatabaseDir, getConfig, getState, saveState, getComposePath, getDatabasePath } from "../lib/fs";
import { allocatePort } from "../lib/ports";
import { generateComposeFile, generateInitScript } from "../lib/compose";
import { startDatabase, getContainerStatus } from "../lib/docker";
import { getPublicIp, buildConnectionUrl } from "../lib/network";
import { generatePassword, generateUsername, isValidName } from "../lib/crypto";
import * as ui from "../lib/ui";
import type { DatabaseState } from "../lib/types";
import { join } from "path";

interface CreateOptions {
  name: string;
  username?: string;
  password?: string;
  database?: string;
  noPooler?: boolean;
}

export async function create(options: CreateOptions): Promise<void> {
  const { name, noPooler = false } = options;

  // Validate name
  const validation = isValidName(name);
  if (!validation.valid) {
    ui.error(validation.error!);
    process.exit(1);
  }

  // Check if already exists
  const state = await getState();
  if (state.databases[name]) {
    ui.error(`Database "${name}" already exists.`);
    ui.info("Use 'pgforge list' to see all databases.");
    process.exit(1);
  }

  // Get or detect public IP
  const config = await getConfig();
  let publicIp = config.publicIp;

  if (!publicIp) {
    const ipSpin = ui.spinner("Detecting public IP...");
    ipSpin.start();
    publicIp = await getPublicIp();
    if (publicIp) {
      ipSpin.succeed(`Public IP: ${publicIp}`);
    } else {
      ipSpin.warn("No public IP found, using localhost");
      publicIp = "localhost";
    }
  }

  // Generate credentials
  const username = options.username || generateUsername();
  const password = options.password || generatePassword();
  const database = options.database || name.replace(/-/g, "_");
  const adminPassword = generatePassword(); // Internal admin, not exposed

  // Allocate port
  const portSpin = ui.spinner("Allocating port...");
  portSpin.start();
  const port = await allocatePort(name);
  portSpin.succeed(`Port allocated: ${port}`);

  // Create database directory
  const dirSpin = ui.spinner("Creating database directory...");
  dirSpin.start();
  await ensureDirectories();
  await ensureDatabaseDir(name);
  dirSpin.succeed("Directory created");

  // Generate docker-compose.yml and init script
  const composeSpin = ui.spinner("Generating Docker Compose configuration...");
  composeSpin.start();

  const composeContent = generateComposeFile({
    name,
    port,
    username,
    password,
    database,
    enablePooler: !noPooler,
    adminPassword,
  });

  // Write compose file
  await Bun.write(getComposePath(name), composeContent);

  // Write init script (creates restricted app user)
  const dbPath = getDatabasePath(name);
  const initDir = join(dbPath, "init");
  await Bun.$`mkdir -p ${initDir}`.quiet();

  const initScript = generateInitScript({ username, password, database });
  const initScriptPath = join(initDir, "01-create-app-user.sh");
  await Bun.write(initScriptPath, initScript);
  await Bun.$`chmod +x ${initScriptPath}`.quiet();

  composeSpin.succeed("Docker Compose configuration generated");

  // Start the database
  const startSpin = ui.spinner("Starting database containers...");
  startSpin.start();

  try {
    await startDatabase(name);
  } catch (err) {
    startSpin.fail("Failed to start database");
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Wait for healthy status
  startSpin.text = "Waiting for database to be ready...";

  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    const status = await getContainerStatus(name);
    if (status === "running") {
      break;
    }
    if (status === "error") {
      startSpin.fail("Database container failed to start");
      ui.error("Check 'docker logs pgforge-" + name + "-pg' for details.");
      process.exit(1);
    }
    await Bun.sleep(1000);
    attempts++;
  }

  if (attempts >= maxAttempts) {
    startSpin.fail("Timeout waiting for database to start");
    process.exit(1);
  }

  startSpin.succeed("Database is running");

  // Build connection URL
  const connectionUrl = buildConnectionUrl({
    host: publicIp!,
    port,
    username,
    password,
    database,
  });

  // Save state
  const dbState: DatabaseState = {
    name,
    port,
    username,
    password,
    database,
    status: "running",
    createdAt: new Date().toISOString(),
    pgVersion: "16-alpine",
    poolerEnabled: !noPooler,
    adminPassword, // Stored for internal backup/restore operations
  };

  state.databases[name] = dbState;
  await saveState(state);

  // Print success
  console.log();
  ui.success(`Database "${name}" created successfully!`);

  ui.printCredentials({
    name,
    host: publicIp!,
    port,
    username,
    password,
    database,
    url: connectionUrl,
  });

  if (!noPooler) {
    ui.info("Connection pooling (PgBouncer) is enabled for serverless compatibility.");
  }

  console.log();
  ui.muted("Copy the connection URL above to use in your application.");
}

import { PATHS, FILES, STATE_VERSION, VERSION } from "./constants";
import type { Config, State, PortRegistry, Migration } from "./types";

// =============================================================================
// STATE MIGRATIONS
// =============================================================================

/**
 * Define migrations for state schema changes
 * Add new migrations when STATE_VERSION is incremented
 */
const stateMigrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema with version field",
    migrate: (data: unknown) => {
      const state = data as { databases?: Record<string, unknown>; lastUpdated?: string };
      return {
        version: 1,
        databases: state.databases || {},
        lastUpdated: state.lastUpdated || new Date().toISOString(),
      };
    },
  },
  // Future migrations go here:
  // {
  //   version: 2,
  //   description: "Add new field",
  //   migrate: (data) => ({ ...data, newField: "default" }),
  // },
];

/**
 * Run migrations on state data
 */
function migrateState(data: unknown, currentVersion: number): State {
  let result = data;
  const version = (data as { version?: number }).version || 0;

  for (const migration of stateMigrations) {
    if (migration.version > version && migration.version <= currentVersion) {
      result = migration.migrate(result);
    }
  }

  return result as State;
}

// =============================================================================
// FILE SYSTEM OPERATIONS
// =============================================================================

/**
 * Ensures all required directories exist with proper permissions
 * Creates all necessary directories for pgforge operation
 */
export async function ensureDirectories(): Promise<void> {
  for (const path of Object.values(PATHS)) {
    const exists = await Bun.file(path).exists().catch(() => false);
    if (!exists) {
      await Bun.$`mkdir -p ${path}`.quiet();
    }
  }

  // Ensure the databases directory has permissions that allow Docker to create mount points
  // This is critical for environments where Docker runs as a different user
  await Bun.$`chmod 755 ${PATHS.databases}`.quiet().nothrow();
}

/**
 * Ensures a database-specific directory exists with proper permissions
 * Creates data, backups, and init directories with permissions that allow Docker to use them
 */
export async function ensureDatabaseDir(dbName: string): Promise<string> {
  const dbPath = `${PATHS.databases}/${dbName}`;

  // Create all required subdirectories
  const mkdirResult = await Bun.$`mkdir -p ${dbPath}/data ${dbPath}/backups ${dbPath}/init`.quiet().nothrow();
  if (mkdirResult.exitCode !== 0) {
    throw new Error(
      `Failed to create database directory: ${dbPath}\n` +
      `Error: ${mkdirResult.stderr.toString()}\n` +
      `Tip: Check that you have write permissions to ${PATHS.databases}\n` +
      `You can set a custom location with: export PGFORGE_HOME=/path/to/writable/dir`
    );
  }

  // Set permissions to 777 for the data directory so Docker can write to it
  // This is necessary because Docker may run as a different user (e.g., root or postgres UID 999)
  // The data directory will be chown'd by postgres container on first run anyway
  await Bun.$`chmod 777 ${dbPath}/data`.quiet().nothrow();

  // Verify the directory was created and is accessible
  const dataExists = await Bun.file(`${dbPath}/data`).exists().catch(() => false);
  if (!dataExists) {
    throw new Error(
      `Database directory was not created properly: ${dbPath}/data\n` +
      `This may be a permissions issue. Try:\n` +
      `  export PGFORGE_HOME=/tmp/pgforge  # or another writable directory`
    );
  }

  return dbPath;
}

/**
 * Read JSON file with type safety
 */
async function readJson<T>(path: string, defaultValue: T): Promise<T> {
  const file = Bun.file(path);
  if (await file.exists()) {
    try {
      return await file.json() as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

/**
 * Write JSON file atomically using temp file + rename
 */
async function writeJson<T>(path: string, data: T): Promise<void> {
  const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    await Bun.write(tempPath, JSON.stringify(data, null, 2));
    await Bun.$`mv ${tempPath} ${path}`.quiet();
  } catch (err) {
    await Bun.$`rm -f ${tempPath}`.quiet().nothrow();
    throw err;
  }
}

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

export async function getConfig(): Promise<Config> {
  return readJson<Config>(FILES.config, {
    initialized: false,
    publicIp: null,
    createdAt: new Date().toISOString(),
    version: VERSION,
  });
}

export async function saveConfig(config: Config): Promise<void> {
  await writeJson(FILES.config, config);
}

// =============================================================================
// STATE OPERATIONS (with automatic migration)
// =============================================================================

export async function getState(): Promise<State> {
  const defaultState: State = {
    version: STATE_VERSION,
    databases: {},
    lastUpdated: new Date().toISOString(),
  };

  const raw = await readJson<unknown>(FILES.state, defaultState);

  // Check if migration is needed
  const rawVersion = (raw as { version?: number }).version || 0;
  if (rawVersion < STATE_VERSION) {
    const migrated = migrateState(raw, STATE_VERSION);
    await saveState(migrated); // Save migrated state
    return migrated;
  }

  return raw as State;
}

export async function saveState(state: State): Promise<void> {
  state.version = STATE_VERSION;
  state.lastUpdated = new Date().toISOString();
  await writeJson(FILES.state, state);
}

// =============================================================================
// PORT REGISTRY OPERATIONS
// =============================================================================

export async function getPortRegistry(): Promise<PortRegistry> {
  const defaultRegistry: PortRegistry = {
    version: STATE_VERSION,
    allocated: {},
    released: [],
    lastUpdated: new Date().toISOString(),
  };

  const raw = await readJson<unknown>(FILES.portRegistry, defaultRegistry);

  // Handle legacy format without version
  const rawVersion = (raw as { version?: number }).version || 0;
  if (rawVersion === 0) {
    const legacy = raw as { allocated?: Record<string, number>; released?: number[] };
    return {
      version: STATE_VERSION,
      allocated: legacy.allocated || {},
      released: legacy.released || [],
      lastUpdated: new Date().toISOString(),
    };
  }

  return raw as PortRegistry;
}

export async function savePortRegistry(registry: PortRegistry): Promise<void> {
  registry.version = STATE_VERSION;
  registry.lastUpdated = new Date().toISOString();
  await writeJson(FILES.portRegistry, registry);
}

/**
 * Get database directory path
 */
export function getDatabasePath(dbName: string): string {
  return `${PATHS.databases}/${dbName}`;
}

/**
 * Get docker-compose.yml path for a database
 */
export function getComposePath(dbName: string): string {
  return `${getDatabasePath(dbName)}/docker-compose.yml`;
}

/**
 * Check if a database directory exists
 */
export async function databaseExists(dbName: string): Promise<boolean> {
  return await Bun.file(getComposePath(dbName)).exists();
}

/**
 * Get all databases from state
 */
export async function getAllDatabases(): Promise<Array<{
  name: string;
  port: number;
  username: string;
  password: string;
  database: string;
  createdAt: string;
}>> {
  const state = await getState();
  return Object.values(state.databases);
}

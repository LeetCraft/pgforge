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
 * Ensures all required directories exist
 */
export async function ensureDirectories(): Promise<void> {
  for (const path of Object.values(PATHS)) {
    await Bun.file(path).exists() || await Bun.$`mkdir -p ${path}`.quiet();
  }
}

/**
 * Ensures a database-specific directory exists
 */
export async function ensureDatabaseDir(dbName: string): Promise<string> {
  const dbPath = `${PATHS.databases}/${dbName}`;
  await Bun.$`mkdir -p ${dbPath}/data ${dbPath}/backups`.quiet();
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

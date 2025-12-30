import { homedir } from "os";
import { join } from "path";

// =============================================================================
// VERSION
// =============================================================================

export const VERSION = "2.0.3";
export const STATE_VERSION = 1; // Increment when state schema changes

// =============================================================================
// PATHS & DIRECTORIES
// =============================================================================

// Base directory for all PgForge data
export const PGFORGE_HOME = join(homedir(), ".pgforge");

// Subdirectories
export const PATHS = {
  root: PGFORGE_HOME,
  bin: join(PGFORGE_HOME, "bin"),
  config: join(PGFORGE_HOME, "config"),
  state: join(PGFORGE_HOME, "state"),
  databases: join(PGFORGE_HOME, "databases"),
  backups: join(PGFORGE_HOME, "backups"),
} as const;

// =============================================================================
// FILES
// =============================================================================

export const FILES = {
  // Config files
  config: join(PATHS.config, "config.json"),
  settings: join(PATHS.config, "settings.json"),
  webConfig: join(PATHS.config, "web.json"),

  // State files
  state: join(PATHS.state, "state.json"),
  portRegistry: join(PATHS.state, "ports.json"),
  metricsDb: join(PATHS.state, "metrics.db"),

  // Daemon files
  daemonPid: join(PATHS.state, "daemon.pid"),
  daemonLock: join(PATHS.state, "daemon.lock"),
  daemonLog: join(PATHS.state, "daemon.log"),
  daemonHealth: join(PATHS.state, "daemon.health"),
} as const;

// =============================================================================
// INTERVALS & TIMEOUTS (in milliseconds)
// =============================================================================

export const INTERVALS = {
  // Daemon intervals
  metricsCollection: 1 * 1000,        // 1 second - collect metrics (real-time)
  healthCheck: 30 * 1000,             // 30 seconds - check database health
  watchdog: 120 * 1000,               // 2 minutes - daemon watchdog timeout
  logRotationCheck: 100,              // Every N collections, check log rotation

  // Web server intervals
  tokenCleanup: 60 * 60 * 1000,       // 1 hour - clean expired tokens
  tokenTTL: 24 * 60 * 60 * 1000,      // 24 hours - token lifetime

  // Retry intervals
  baseRestartDelay: 1000,             // 1 second - initial retry delay
  maxRestartDelay: 60 * 1000,         // 1 minute - max retry delay
} as const;

export const TIMEOUTS = {
  containerStart: 30 * 1000,          // 30 seconds - wait for container
  gracefulShutdown: 10 * 1000,        // 10 seconds - graceful daemon stop
} as const;

export const LIMITS = {
  maxRestartAttempts: 5,              // Max daemon restart attempts
  maxTokens: 1000,                    // Max concurrent auth tokens
  maxMetricsCount: 1_000_000,         // Reset counter after this many
  metricsRetentionDays: 30,           // Days to keep metrics
  cleanupEveryNCollections: 60,       // Cleanup old metrics every N collections
  logRotationSize: 10 * 1024 * 1024,  // 10MB - rotate logs
  maxLogFiles: 5,                     // Number of rotated log files to keep
} as const;

// =============================================================================
// NETWORKING
// =============================================================================

// Web panel port (fixed)
export const WEB_PORT = 19000;

// Port range for databases (each db gets a unique port)
// Range: 19001-19999 (999 available ports)
export const PORT_RANGE = {
  start: 19001,
  end: 19999,
} as const;

// Docker network name (internal, not exposed)
export const INTERNAL_NETWORK = "pgforge-internal";

// =============================================================================
// DATABASE DEFAULTS
// =============================================================================

// Default PostgreSQL settings
export const POSTGRES_DEFAULTS = {
  version: "16-alpine",
  maxConnections: 200,
  sharedBuffers: "128MB",
} as const;

// PgBouncer settings
export const PGBOUNCER_DEFAULTS = {
  image: "edoburu/pgbouncer:latest",
  poolMode: "transaction",
  defaultPoolSize: 20,
  maxClientConn: 1000,
  maxDbConnections: 100,
} as const;

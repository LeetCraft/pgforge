import { homedir } from "os";
import { join } from "path";

// =============================================================================
// VERSION
// =============================================================================

export const VERSION = "2.2.0";
export const STATE_VERSION = 1; // Increment when state schema changes

// =============================================================================
// PATHS & DIRECTORIES
// =============================================================================

// Base directory for all PgForge data
// Can be overridden with PGFORGE_HOME environment variable
// In sandboxed environments, this may be auto-detected to /tmp/pgforge during setup
let _pgforgeHome = process.env.PGFORGE_HOME || join(homedir(), ".pgforge");

// Allow runtime update of PGFORGE_HOME (called by setup when auto-detecting path)
export function setPgforgeHome(path: string): void {
  _pgforgeHome = path;
  // Also set env var so child processes inherit it
  process.env.PGFORGE_HOME = path;
}

// Getter for current PGFORGE_HOME
export function getPgforgeHome(): string {
  return _pgforgeHome;
}

// For backwards compatibility, export as const (but use getter for dynamic paths)
export const PGFORGE_HOME = _pgforgeHome;

// Dynamic path getters (use these instead of PATHS for runtime flexibility)
export function getPaths() {
  const home = _pgforgeHome;
  return {
    root: home,
    bin: join(home, "bin"),
    config: join(home, "config"),
    state: join(home, "state"),
    databases: join(home, "databases"),
    backups: join(home, "backups"),
  };
}

export function getFiles() {
  const paths = getPaths();
  return {
    // Config files
    config: join(paths.config, "config.json"),
    settings: join(paths.config, "settings.json"),
    webConfig: join(paths.config, "web.json"),

    // State files
    state: join(paths.state, "state.json"),
    portRegistry: join(paths.state, "ports.json"),
    metricsDb: join(paths.state, "metrics.db"),

    // Daemon files
    daemonPid: join(paths.state, "daemon.pid"),
    daemonLock: join(paths.state, "daemon.lock"),
    daemonLog: join(paths.state, "daemon.log"),
    daemonHealth: join(paths.state, "daemon.health"),

    // Web server files
    webPid: join(paths.state, "web.pid"),
  };
}

// Static versions for backwards compatibility (computed at load time)
// NOTE: For dynamic paths after setup, use getPaths() and getFiles()
export const PATHS = getPaths();
export const FILES = getFiles();

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
export const WEB_PORT = 56432;

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

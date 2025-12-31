import { homedir, platform } from "os";
import { join } from "path";
import { PATHS, getFiles, INTERVALS, LIMITS, VERSION } from "./constants";
import { getAllDatabases } from "./fs";
import { startDatabase, getContainerStatus } from "./docker";
import { collectAllMetrics } from "./collector";
import { closeMetricsDb } from "./metrics";
import { isBackupDue, runScheduledBackup } from "./s3";

// ============================================================================
// CONSTANTS (using dynamic getters for paths)
// ============================================================================

// These getters ensure paths are resolved at runtime after setup may have changed PGFORGE_HOME
const getDaemonPidFile = () => getFiles().daemonPid;
const getDaemonLockFile = () => getFiles().daemonLock;
const getDaemonLogFile = () => getFiles().daemonLog;
const getDaemonHealthFile = () => getFiles().daemonHealth;
const getSettingsFile = () => getFiles().settings;

// Intervals (from centralized constants)
const COLLECTION_INTERVAL = INTERVALS.metricsCollection;
const HEALTH_CHECK_INTERVAL = INTERVALS.healthCheck;
const WATCHDOG_INTERVAL = INTERVALS.watchdog;
const LOG_ROTATION_SIZE = LIMITS.logRotationSize;
const MAX_LOG_FILES = LIMITS.maxLogFiles;

// Retry settings (from centralized constants)
const MAX_RESTART_ATTEMPTS = LIMITS.maxRestartAttempts;
const BASE_RESTART_DELAY = INTERVALS.baseRestartDelay;
const MAX_RESTART_DELAY = INTERVALS.maxRestartDelay;

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

interface Settings {
  logsEnabled: boolean;
}

async function getSettings(): Promise<Settings> {
  try {
    const file = Bun.file(getSettingsFile());
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return { logsEnabled: false };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await atomicWrite(getSettingsFile(), JSON.stringify(settings, null, 2));
}

export async function setLogsEnabled(enabled: boolean): Promise<void> {
  const settings = await getSettings();
  settings.logsEnabled = enabled;
  await saveSettings(settings);
}

export async function getLogsEnabled(): Promise<boolean> {
  const settings = await getSettings();
  return settings.logsEnabled;
}

// ============================================================================
// ATOMIC FILE OPERATIONS
// ============================================================================

/**
 * Write file atomically using rename
 */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    await Bun.write(tempPath, content);
    await Bun.$`mv ${tempPath} ${path}`.quiet();
  } catch (err) {
    // Clean up temp file on error
    await Bun.$`rm -f ${tempPath}`.quiet().nothrow();
    throw err;
  }
}

/**
 * Read file safely with fallback
 */
async function safeRead(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
  } catch {}
  return null;
}

// ============================================================================
// PROCESS LOCK (Prevent multiple daemon instances)
// ============================================================================

interface LockInfo {
  pid: number;
  startedAt: number;
  hostname: string;
}

/**
 * Acquire exclusive lock for daemon
 */
async function acquireLock(): Promise<boolean> {
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    hostname: (await Bun.$`hostname`.quiet().nothrow()).text().trim() || "unknown",
  };

  try {
    // Check if lock exists and is stale
    const existingLock = await safeRead(getDaemonLockFile());
    if (existingLock) {
      try {
        const existing = JSON.parse(existingLock) as LockInfo;
        // Check if the process is still running
        const isRunning = await isProcessRunning(existing.pid);
        if (isRunning) {
          return false; // Another daemon is running
        }
        // Stale lock, remove it
        await Bun.$`rm -f ${getDaemonLockFile()}`.quiet().nothrow();
      } catch {
        // Invalid lock file, remove it
        await Bun.$`rm -f ${getDaemonLockFile()}`.quiet().nothrow();
      }
    }

    // Create lock file atomically
    await atomicWrite(getDaemonLockFile(), JSON.stringify(lockInfo, null, 2));

    // Verify we got the lock (handle race condition)
    await Bun.sleep(100);
    const verifyLock = await safeRead(getDaemonLockFile());
    if (verifyLock) {
      const verify = JSON.parse(verifyLock) as LockInfo;
      return verify.pid === process.pid;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Release the daemon lock
 */
async function releaseLock(): Promise<void> {
  try {
    const lockContent = await safeRead(getDaemonLockFile());
    if (lockContent) {
      const lock = JSON.parse(lockContent) as LockInfo;
      if (lock.pid === process.pid) {
        await Bun.$`rm -f ${getDaemonLockFile()}`.quiet().nothrow();
      }
    }
  } catch {}
}

// ============================================================================
// PROCESS MANAGEMENT
// ============================================================================

/**
 * Check if a process is running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const result = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if daemon is running
 */
export async function isDaemonRunning(): Promise<boolean> {
  const pidContent = await safeRead(getDaemonPidFile());
  if (!pidContent) return false;

  const pid = parseInt(pidContent.trim(), 10);
  if (isNaN(pid)) return false;

  return await isProcessRunning(pid);
}

/**
 * Get daemon PID
 */
export async function getDaemonPid(): Promise<number | null> {
  const pidContent = await safeRead(getDaemonPidFile());
  if (!pidContent) return null;

  const pid = parseInt(pidContent.trim(), 10);
  return isNaN(pid) ? null : pid;
}

/**
 * Get daemon health status
 */
export async function getDaemonHealth(): Promise<{
  running: boolean;
  lastHeartbeat: number | null;
  uptime: number | null;
  healthy: boolean;
}> {
  const running = await isDaemonRunning();

  if (!running) {
    return { running: false, lastHeartbeat: null, uptime: null, healthy: false };
  }

  try {
    const healthContent = await safeRead(getDaemonHealthFile());
    if (healthContent) {
      const health = JSON.parse(healthContent);
      const lastHeartbeat = health.timestamp;
      const uptime = Date.now() - health.startedAt;
      const healthy = Date.now() - lastHeartbeat < WATCHDOG_INTERVAL;
      return { running, lastHeartbeat, uptime, healthy };
    }
  } catch {}

  return { running, lastHeartbeat: null, uptime: null, healthy: false };
}

// ============================================================================
// DAEMON START/STOP
// ============================================================================

/**
 * Ensure daemon is running - start it if not
 */
export async function ensureDaemonRunning(): Promise<{ success: boolean; message: string }> {
  // Check if already running
  const health = await getDaemonHealth();
  if (health.running && health.healthy) {
    return { success: true, message: "Daemon already running and healthy" };
  }

  // If running but unhealthy, stop it first
  if (health.running && !health.healthy) {
    await stopDaemon();
    await Bun.sleep(1000);
  }

  return await startDaemonProcess();
}

/**
 * Start the daemon process in background with retry logic
 */
async function startDaemonProcess(attempt = 1): Promise<{ success: boolean; message: string }> {
  const os = platform();

  if (os !== "linux") {
    return { success: false, message: "PgForge only supports Linux with systemd" };
  }

  try {
    // Use the installed pgforge binary path directly instead of process.argv
    // process.argv paths can be internal bunfs paths that don't work outside the executable
    const pgforgeBinPath = `${homedir()}/.pgforge/bin/pgforge`;

    // Use nohup with proper output redirection and process detachment
    // Include common docker paths in PATH to ensure docker is found
    // Write a helper script and use sg docker to run it with docker group
    const dockerPaths = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    const helperScript = `#!/bin/sh
export PATH="${dockerPaths}:$PATH"
exec nohup "${pgforgeBinPath}" daemon run >> "${getDaemonLogFile()}" 2>&1 &
`;
    const helperPath = `${homedir()}/.pgforge/state/daemon-start.sh`;
    await Bun.write(helperPath, helperScript);
    await Bun.$`chmod +x ${helperPath}`.quiet();
    await Bun.$`sg docker -c ${helperPath}`.quiet().nothrow();

    // Wait for daemon to start with exponential backoff check
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(500 + i * 200);
      const health = await getDaemonHealth();
      if (health.running) {
        return { success: true, message: "Daemon started successfully" };
      }
    }

    // Retry with exponential backoff
    if (attempt < MAX_RESTART_ATTEMPTS) {
      const delay = Math.min(BASE_RESTART_DELAY * Math.pow(2, attempt - 1), MAX_RESTART_DELAY);
      await Bun.sleep(delay);
      return startDaemonProcess(attempt + 1);
    }

    return { success: false, message: `Daemon failed to start after ${MAX_RESTART_ATTEMPTS} attempts` };
  } catch (err) {
    if (attempt < MAX_RESTART_ATTEMPTS) {
      const delay = Math.min(BASE_RESTART_DELAY * Math.pow(2, attempt - 1), MAX_RESTART_DELAY);
      await Bun.sleep(delay);
      return startDaemonProcess(attempt + 1);
    }
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stop the daemon process gracefully
 */
export async function stopDaemon(): Promise<{ success: boolean; message: string }> {
  const pid = await getDaemonPid();

  if (!pid) {
    // Clean up stale files
    await Bun.$`rm -f ${getDaemonPidFile()} ${getDaemonLockFile()} ${getDaemonHealthFile()}`.quiet().nothrow();
    return { success: true, message: "Daemon is not running" };
  }

  try {
    // Send SIGTERM first (graceful shutdown)
    await Bun.$`kill -TERM ${pid}`.quiet().nothrow();

    // Wait for graceful shutdown (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(500);
      if (!(await isProcessRunning(pid))) {
        await Bun.$`rm -f ${getDaemonPidFile()} ${getDaemonLockFile()} ${getDaemonHealthFile()}`.quiet().nothrow();
        return { success: true, message: "Daemon stopped gracefully" };
      }
    }

    // Force kill if still running
    await Bun.$`kill -KILL ${pid}`.quiet().nothrow();
    await Bun.sleep(500);

    await Bun.$`rm -f ${getDaemonPidFile()} ${getDaemonLockFile()} ${getDaemonHealthFile()}`.quiet().nothrow();
    return { success: true, message: "Daemon force stopped" };
  } catch (err) {
    await Bun.$`rm -f ${getDaemonPidFile()} ${getDaemonLockFile()} ${getDaemonHealthFile()}`.quiet().nothrow();
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// DATABASE MANAGEMENT
// ============================================================================

/**
 * Restart all stopped databases with retry logic
 */
export async function restartAllDatabases(): Promise<{ started: string[]; failed: string[] }> {
  const databases = await getAllDatabases();
  const started: string[] = [];
  const failed: string[] = [];

  for (const db of databases) {
    let success = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const status = await getContainerStatus(db.name);

        if (status === "running") {
          success = true;
          break;
        }

        if (status === "stopped" || status === "not_found") {
          await startDatabase(db.name);
          // Verify it started
          await Bun.sleep(2000);
          const newStatus = await getContainerStatus(db.name);
          if (newStatus === "running") {
            started.push(db.name);
            success = true;
            break;
          }
        }
      } catch {
        if (attempt < 3) {
          await Bun.sleep(1000 * attempt);
        }
      }
    }

    if (!success && !started.includes(db.name)) {
      failed.push(db.name);
    }
  }

  return { started, failed };
}

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Rotate log files if needed
 */
async function rotateLogsIfNeeded(): Promise<void> {
  try {
    const logFile = Bun.file(getDaemonLogFile());
    if (!(await logFile.exists())) return;

    const stats = await logFile.size;
    if (stats < LOG_ROTATION_SIZE) return;

    // Rotate logs
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldPath = `${getDaemonLogFile()}.${i}`;
      const newPath = `${getDaemonLogFile()}.${i + 1}`;
      await Bun.$`mv ${oldPath} ${newPath}`.quiet().nothrow();
    }

    await Bun.$`mv ${getDaemonLogFile()} ${getDaemonLogFile()}.1`.quiet().nothrow();
  } catch {}
}

/**
 * Create logger with rotation support
 */
function createLogger(enabled: boolean, startTime: number) {
  return {
    log: (level: "INFO" | "WARN" | "ERROR", message: string) => {
      if (!enabled && level === "INFO") return;

      const timestamp = new Date().toISOString();
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const line = `[${timestamp}] [${level}] [uptime:${uptime}s] ${message}`;

      if (enabled) {
        console.log(line);
      }

      // Always log errors
      if (level === "ERROR") {
        console.error(line);
      }
    },
    info: (message: string) => {
      if (enabled) console.log(`[${new Date().toISOString()}] [INFO] ${message}`);
    },
    warn: (message: string) => {
      console.log(`[${new Date().toISOString()}] [WARN] ${message}`);
    },
    error: (message: string) => {
      console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
    },
  };
}

// ============================================================================
// HEALTH CHECK & HEARTBEAT
// ============================================================================

/**
 * Write health heartbeat
 */
async function writeHealthbeat(startedAt: number, metricsCollected: number): Promise<void> {
  const health = {
    pid: process.pid,
    timestamp: Date.now(),
    startedAt,
    metricsCollected,
    version: VERSION,
  };

  try {
    await atomicWrite(getDaemonHealthFile(), JSON.stringify(health, null, 2));
  } catch {}
}

// ============================================================================
// SIGNAL HANDLING
// ============================================================================

let isShuttingDown = false;

function setupSignalHandlers(logger: ReturnType<typeof createLogger>, cleanup: () => Promise<void>) {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await cleanup();
      logger.info("Cleanup complete, exiting");
      process.exit(0);
    } catch (err) {
      logger.error(`Error during shutdown: ${err}`);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  // Handle uncaught errors
  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
    // Don't exit, try to continue
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    // Don't exit, try to continue
  });
}

// ============================================================================
// AUTOSTART INSTALLATION
// ============================================================================

/**
 * Check if systemd is available on Linux
 */
async function hasSystemd(): Promise<boolean> {
  const result = await Bun.$`which systemctl`.quiet().nothrow();
  if (result.exitCode !== 0) return false;

  // Also check if systemd is actually running
  const running = await Bun.$`systemctl --user status`.quiet().nothrow();
  return running.exitCode === 0 || running.exitCode === 1; // 1 means some units failed but systemd is running
}

/**
 * Generate systemd service for Linux
 */
function generateSystemdService(): string {
  const cliPath = join(homedir(), ".pgforge", "bin", "pgforge");

  return `[Unit]
Description=PgForge Database Management Daemon
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=simple
ExecStart=${cliPath} daemon run
Restart=always
RestartSec=10
WatchdogSec=180
TimeoutStopSec=30
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${homedir()}/.pgforge/bin
StandardOutput=append:${getDaemonLogFile()}
StandardError=append:${getDaemonLogFile()}

# Resource limits
MemoryMax=512M
CPUQuota=50%

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;
}

/**
 * Install autostart service (Linux systemd only)
 */
export async function installAutostart(): Promise<{ success: boolean; message: string }> {
  const os = platform();

  if (os !== "linux") {
    return { success: false, message: "PgForge only supports Linux with systemd" };
  }

  // Require systemd - no fallback to cron
  if (!(await hasSystemd())) {
    return { success: false, message: "systemd is required. PgForge does not support non-systemd Linux distributions." };
  }

  const servicePath = join(homedir(), ".config", "systemd", "user", "pgforge.service");
  const serviceContent = generateSystemdService();

  try {
    await Bun.$`mkdir -p ${join(homedir(), ".config", "systemd", "user")}`.quiet();
    await atomicWrite(servicePath, serviceContent);

    const reload = await Bun.$`systemctl --user daemon-reload`.quiet().nothrow();
    const enable = await Bun.$`systemctl --user enable pgforge.service`.quiet().nothrow();
    await Bun.$`systemctl --user start pgforge.service`.quiet().nothrow();

    if (reload.exitCode === 0 && enable.exitCode === 0) {
      return { success: true, message: "Installed systemd user service" };
    } else {
      return { success: false, message: "Failed to install systemd service" };
    }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// MAIN DAEMON LOOP
// ============================================================================

/**
 * Main daemon loop - runs forever collecting metrics and managing databases
 */
export async function runDaemonLoop(): Promise<never> {
  const startedAt = Date.now();
  let metricsCollected = 0;

  // Acquire lock
  const gotLock = await acquireLock();
  if (!gotLock) {
    console.error("Another daemon instance is already running");
    process.exit(1);
  }

  // Write PID file
  await atomicWrite(getDaemonPidFile(), String(process.pid));

  // Initial health heartbeat
  await writeHealthbeat(startedAt, 0);

  // Get settings
  const logsEnabled = await getLogsEnabled();
  const logger = createLogger(logsEnabled, startedAt);

  // Cleanup function
  const cleanup = async () => {
    // Close metrics database connection
    closeMetricsDb();
    await releaseLock();
    await Bun.$`rm -f ${getDaemonPidFile()} ${getDaemonHealthFile()}`.quiet().nothrow();
  };

  // Setup signal handlers
  setupSignalHandlers(logger, cleanup);

  logger.info(`PgForge daemon started (PID: ${process.pid})`);
  logger.info(`Platform: ${platform()}, Node: ${process.version}`);

  // Rotate logs if needed
  await rotateLogsIfNeeded();

  // On startup, restart all databases
  logger.info("Starting all databases...");
  const { started, failed } = await restartAllDatabases();

  if (started.length > 0) {
    logger.info(`Started databases: ${started.join(", ")}`);
  }
  if (failed.length > 0) {
    logger.warn(`Failed to start: ${failed.join(", ")}`);
  }

  // Health check interval
  let lastHealthCheck = Date.now();

  // Counter for log rotation (separate from metricsCollected to avoid overflow)
  let loopCount = 0;
  const LOG_ROTATE_INTERVAL = INTERVALS.logRotationCheck;
  const MAX_METRICS_COUNT = LIMITS.maxMetricsCount;

  // Main loop
  while (!isShuttingDown) {
    try {
      // Collect metrics
      const collected = await collectAllMetrics();
      metricsCollected += collected;

      // Reset counter to prevent overflow (keeps last 6 digits for display)
      if (metricsCollected > MAX_METRICS_COUNT) {
        metricsCollected = metricsCollected % MAX_METRICS_COUNT;
      }

      logger.info(`Collected metrics for ${collected} databases (total: ${metricsCollected})`);

      // Health heartbeat
      await writeHealthbeat(startedAt, metricsCollected);

      // Periodic health check - verify databases are running
      if (Date.now() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
        lastHealthCheck = Date.now();

        const databases = await getAllDatabases();
        for (const db of databases) {
          const status = await getContainerStatus(db.name);
          if (status === "stopped" || status === "error") {
            logger.warn(`Database ${db.name} is ${status}, attempting restart...`);
            try {
              await startDatabase(db.name);
              logger.info(`Successfully restarted database ${db.name}`);
            } catch (err) {
              logger.error(`Failed to restart database ${db.name}: ${err}`);
            }
          }
        }
      }

      // Rotate logs periodically using separate counter
      loopCount++;
      if (loopCount >= LOG_ROTATE_INTERVAL) {
        loopCount = 0;
        await rotateLogsIfNeeded();
      }

      // S3 scheduled backup
      try {
        if (await isBackupDue()) {
          logger.info("S3 backup is due, starting scheduled backup...");
          const backupResult = await runScheduledBackup();
          if (backupResult.backed.length > 0) {
            logger.info(`S3 backup completed: ${backupResult.backed.join(", ")}`);
          }
          if (backupResult.failed.length > 0) {
            logger.warn(`S3 backup failed: ${backupResult.failed.map((f) => `${f.name}: ${f.error}`).join(", ")}`);
          }
        }
      } catch (err) {
        logger.error(`S3 backup error: ${err}`);
      }
    } catch (err) {
      logger.error(`Error in main loop: ${err}`);
      // Continue running despite errors
    }

    // Sleep until next collection
    await Bun.sleep(COLLECTION_INTERVAL);
  }

  // Cleanup on exit
  await cleanup();
  process.exit(0);
}

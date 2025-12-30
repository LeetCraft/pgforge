import { getComposePath, getDatabasePath } from "./fs";

// Docker binary path - resolved at runtime
let dockerPath = "docker";
let dockerPathResolved = false;

async function resolveDockerPath(): Promise<void> {
  if (dockerPathResolved) return;
  const paths = ["/usr/bin/docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"];
  for (const p of paths) {
    try {
      const file = Bun.file(p);
      if (await file.exists()) {
        dockerPath = p;
        dockerPathResolved = true;
        return;
      }
    } catch {}
  }
  dockerPathResolved = true;
}

// Resolve on module load
const dockerPathPromise = resolveDockerPath();

/**
 * Get the docker command (ensures path is resolved)
 */
async function docker(): Promise<string> {
  await dockerPathPromise;
  return dockerPath;
}

/**
 * Get the resolved docker path for external use
 */
export async function getDockerPath(): Promise<string> {
  await dockerPathPromise;
  return dockerPath;
}

/**
 * Check if Docker is installed and running
 */
export async function checkDocker(): Promise<{
  installed: boolean;
  running: boolean;
  compose: boolean;
  permissionDenied: boolean;
}> {
  const d = await docker();
  const dockerInstalled = await Bun.$`${{ raw: d }} --version`.quiet().nothrow();
  if (dockerInstalled.exitCode !== 0) {
    return { installed: false, running: false, compose: false, permissionDenied: false };
  }

  const dockerRunning = await Bun.$`${{ raw: d }} info`.quiet().nothrow();
  if (dockerRunning.exitCode !== 0) {
    // Check if it's a permission issue
    const stderr = dockerRunning.stderr.toString().toLowerCase();
    const permissionDenied = stderr.includes("permission denied") ||
                             stderr.includes("connect: permission denied") ||
                             stderr.includes("got permission denied");
    return { installed: true, running: false, compose: false, permissionDenied };
  }

  const composeInstalled = await Bun.$`${{ raw: d }} compose version`.quiet().nothrow();
  return {
    installed: true,
    running: true,
    compose: composeInstalled.exitCode === 0,
    permissionDenied: false,
  };
}

/**
 * Start a database using docker compose
 */
export async function startDatabase(dbName: string): Promise<void> {
  const composePath = getComposePath(dbName);
  const dbPath = getDatabasePath(dbName);
  const d = await docker();

  await Bun.$`${{ raw: d }} compose -f ${composePath} -p pgforge-${dbName} up -d`.cwd(dbPath);
}

/**
 * Stop a database using docker compose
 */
export async function stopDatabase(dbName: string): Promise<void> {
  const composePath = getComposePath(dbName);
  const dbPath = getDatabasePath(dbName);
  const d = await docker();

  await Bun.$`${{ raw: d }} compose -f ${composePath} -p pgforge-${dbName} stop`.cwd(dbPath);
}

/**
 * Destroy a database (stop and remove volumes)
 */
export async function destroyDatabase(dbName: string): Promise<void> {
  const composePath = getComposePath(dbName);
  const dbPath = getDatabasePath(dbName);
  const d = await docker();

  await Bun.$`${{ raw: d }} compose -f ${composePath} -p pgforge-${dbName} down -v --remove-orphans`.cwd(dbPath).nothrow();
}

/**
 * Get database container status
 */
export async function getContainerStatus(dbName: string): Promise<"running" | "stopped" | "error" | "not_found"> {
  const d = await docker();
  // Check for pgbouncer container first (it's the main exposed service)
  const bouncerResult = await Bun.$`${{ raw: d }} inspect --format='{{.State.Status}}' pgforge-${dbName}-bouncer`
    .quiet()
    .nothrow();

  if (bouncerResult.exitCode === 0) {
    const status = bouncerResult.text().trim();
    if (status === "running") return "running";
    if (status === "exited" || status === "created") return "stopped";
    return "error";
  }

  // Fall back to checking postgres container (for non-pooler setups)
  const pgResult = await Bun.$`${{ raw: d }} inspect --format='{{.State.Status}}' pgforge-${dbName}-pg`
    .quiet()
    .nothrow();

  if (pgResult.exitCode === 0) {
    const status = pgResult.text().trim();
    if (status === "running") return "running";
    if (status === "exited" || status === "created") return "stopped";
    return "error";
  }

  return "not_found";
}

/**
 * Get container logs
 */
export async function getContainerLogs(dbName: string, lines: number = 50): Promise<string> {
  const d = await docker();
  const result = await Bun.$`${{ raw: d }} logs --tail ${lines} pgforge-${dbName}-pg`.quiet().nothrow();
  return result.text();
}

/**
 * Execute a command in the postgres container
 */
export async function execInContainer(
  dbName: string,
  command: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const d = await docker();
  const result = await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg ${command}`.quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * Create a database backup
 * Uses pgadmin (internal superuser) for full backup access
 */
export async function createBackup(
  dbName: string,
  database: string
): Promise<string> {
  const dbPath = getDatabasePath(dbName);
  const backupDir = `${dbPath}/backups`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `${backupDir}/${dbName}_${timestamp}.sql.gz`;
  const d = await docker();

  await Bun.$`mkdir -p ${backupDir}`.quiet();

  // Use pg_dump with pgadmin (superuser) and compress
  await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg pg_dump -U pgadmin ${database} | gzip > ${backupFile}`;

  return backupFile;
}

/**
 * Restore a database from backup
 * Uses pgadmin (internal superuser) for full restore access
 */
export async function restoreBackup(
  dbName: string,
  database: string,
  backupFile: string
): Promise<void> {
  const d = await docker();
  // Restore using pgadmin
  await Bun.$`gunzip -c ${backupFile} | ${{ raw: d }} exec -i pgforge-${dbName}-pg psql -U pgadmin ${database}`;
}

/**
 * List available backups for a database
 */
export async function listBackups(dbName: string): Promise<Array<{ file: string; size: number; date: Date }>> {
  const dbPath = getDatabasePath(dbName);
  const backupDir = `${dbPath}/backups`;

  const result = await Bun.$`ls -la ${backupDir}/*.sql.gz 2>/dev/null || true`.quiet().nothrow();

  if (!result.text().trim()) {
    return [];
  }

  const lines = result.text().trim().split("\n").filter(Boolean);
  const backups: Array<{ file: string; size: number; date: Date }> = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 9) {
      const size = parseInt(parts[4], 10);
      const fileName = parts.slice(8).join(" ");
      // Parse date from filename: dbname_2024-01-15T10-30-00-000Z.sql.gz
      const match = fileName.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      const date = match ? new Date(match[1].replace(/-/g, (m, i) => i > 9 ? ":" : m)) : new Date();

      backups.push({ file: fileName, size, date });
    }
  }

  return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Get database statistics
 * Uses pgadmin for stats access
 */
export async function getDatabaseStats(
  dbName: string,
  database: string
): Promise<{
  size: string;
  connections: number;
  tables: number;
}> {
  const d = await docker();
  const sizeResult = await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg psql -U pgadmin -d ${database} -t -c "SELECT pg_size_pretty(pg_database_size('${database}'))"`
    .quiet()
    .nothrow();

  const connResult = await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg psql -U pgadmin -d ${database} -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '${database}'"`
    .quiet()
    .nothrow();

  const tablesResult = await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg psql -U pgadmin -d ${database} -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"`
    .quiet()
    .nothrow();

  return {
    size: sizeResult.exitCode === 0 ? sizeResult.text().trim() : "N/A",
    connections: connResult.exitCode === 0 ? parseInt(connResult.text().trim(), 10) || 0 : 0,
    tables: tablesResult.exitCode === 0 ? parseInt(tablesResult.text().trim(), 10) || 0 : 0,
  };
}

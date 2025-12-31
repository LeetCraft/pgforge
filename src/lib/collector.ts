import { getAllDatabases, getState } from "./fs";
import { getContainerStatus, getDockerPath } from "./docker";
import { recordMetrics, initMetricsDb, updateLastCollectionTime, cleanupOldMetrics } from "./metrics";
import { LIMITS, PATHS } from "./constants";
import type { MetricPoint } from "./metrics";

// Track collection count for deterministic cleanup
let collectionCount = 0;
const CLEANUP_EVERY_N_COLLECTIONS = LIMITS.cleanupEveryNCollections;

interface PostgresStats {
  cpu_percent: number;
  memory_mb: number;
  connections: number;
  disk_mb: number;
}

/**
 * Get database stats directly from PostgreSQL
 * Uses pg_stat_* views for accurate metrics
 */
async function getPostgresStats(dbName: string, database: string): Promise<PostgresStats> {
  try {
    const dockerPath = await getDockerPath();
    const containerName = `pgforge-${dbName}-pg`;

    // Query PostgreSQL for stats
    // 1. Active connections from pg_stat_activity
    // 2. Database size from pg_database_size
    // 3. Memory usage from pg_stat_bgwriter and shared buffers
    const statsQuery = `
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as connections,
        pg_database_size(current_database()) / 1024 / 1024 as disk_mb,
        (SELECT setting::bigint * 8192 / 1024 / 1024 FROM pg_settings WHERE name = 'shared_buffers') as shared_buffers_mb,
        (SELECT blks_hit * 100.0 / NULLIF(blks_hit + blks_read, 0) FROM pg_stat_database WHERE datname = current_database()) as cache_hit_ratio
    `;

    const result = await Bun.$`${{ raw: dockerPath }} exec ${containerName} psql -U pgadmin -d ${database} -t -A -F ',' -c ${statsQuery}`
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      // Fallback to Docker stats if PostgreSQL query fails
      return await getDockerStats(dbName);
    }

    const output = result.text().trim();
    const parts = output.split(",");

    const connections = parseInt(parts[0], 10) || 0;
    const disk_mb = parseFloat(parts[1]) || 0;
    const shared_buffers_mb = parseFloat(parts[2]) || 0;

    // Get CPU usage from PostgreSQL backend stats
    // This is an approximation based on active backends vs max connections
    const cpuQuery = `
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND datname = current_database()) as active,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_conn
    `;
    const cpuResult = await Bun.$`${{ raw: dockerPath }} exec ${containerName} psql -U pgadmin -d ${database} -t -A -F ',' -c ${cpuQuery}`
      .quiet()
      .nothrow();

    let cpu_percent = 0;
    if (cpuResult.exitCode === 0) {
      const cpuParts = cpuResult.text().trim().split(",");
      const active = parseInt(cpuParts[0], 10) || 0;
      const maxConn = parseInt(cpuParts[1], 10) || 100;
      // Estimate CPU as percentage of active connections
      // Each active query typically uses some CPU
      cpu_percent = Math.min((active / maxConn) * 100, 100);
    }

    // Memory is approximated from shared_buffers (actual memory managed by PostgreSQL)
    // Add overhead for per-connection memory (work_mem, etc)
    const memory_mb = shared_buffers_mb + (connections * 4); // ~4MB per connection average

    return {
      cpu_percent,
      memory_mb,
      connections,
      disk_mb,
    };
  } catch {
    return await getDockerStats(dbName);
  }
}

/**
 * Fallback: Get Docker container resource stats
 */
async function getDockerStats(dbName: string): Promise<PostgresStats> {
  try {
    const dockerPath = await getDockerPath();
    // Use docker stats for real-time CPU and memory
    const result = await Bun.$`${{ raw: dockerPath }} stats --no-stream --format "{{.CPUPerc}},{{.MemUsage}}" pgforge-${dbName}-pg`
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      return { cpu_percent: 0, memory_mb: 0, connections: 0, disk_mb: 0 };
    }

    const output = result.text().trim();
    const [cpuStr, memStr] = output.split(",");

    // Parse CPU percentage (remove % sign)
    const cpu_percent = parseFloat(cpuStr?.replace("%", "") || "0") || 0;

    // Parse memory (format: "123.4MiB / 7.8GiB")
    let memory_mb = 0;
    if (memStr) {
      const memMatch = memStr.match(/([\d.]+)\s*(MiB|GiB|KiB|B)/i);
      if (memMatch) {
        const value = parseFloat(memMatch[1]);
        const unit = memMatch[2].toLowerCase();
        switch (unit) {
          case "gib":
            memory_mb = value * 1024;
            break;
          case "mib":
            memory_mb = value;
            break;
          case "kib":
            memory_mb = value / 1024;
            break;
          default:
            memory_mb = value / (1024 * 1024);
        }
      }
    }

    // Get disk usage from filesystem
    const diskResult = await Bun.$`du -sm ${PATHS.databases}/${dbName}/data 2>/dev/null | cut -f1`
      .quiet()
      .nothrow();
    const disk_mb = diskResult.exitCode === 0 ? parseInt(diskResult.text().trim(), 10) || 0 : 0;

    return { cpu_percent, memory_mb, connections: 0, disk_mb };
  } catch {
    return { cpu_percent: 0, memory_mb: 0, connections: 0, disk_mb: 0 };
  }
}

/**
 * Get host machine resource stats
 */
export async function getMachineStats(): Promise<{
  cpu_percent: number;
  memory_mb: number;
  memory_total_mb: number;
  disk_mb: number;
  disk_total_mb: number;
  load_avg: number[];
}> {
  try {
    // Get CPU usage from /proc/stat (Linux) or top (macOS)
    let cpu_percent = 0;
    const cpuResult = await Bun.$`top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1`
      .quiet()
      .nothrow();
    if (cpuResult.exitCode === 0) {
      cpu_percent = parseFloat(cpuResult.text().trim()) || 0;
    } else {
      // macOS fallback
      const macCpu = await Bun.$`top -l 1 | grep "CPU usage" | awk '{print $3}' | cut -d'%' -f1`
        .quiet()
        .nothrow();
      cpu_percent = parseFloat(macCpu.text().trim()) || 0;
    }

    // Get memory from free command (Linux) or vm_stat (macOS)
    let memory_mb = 0;
    let memory_total_mb = 0;
    const memResult = await Bun.$`free -m 2>/dev/null | grep Mem | awk '{print $2,$3}'`
      .quiet()
      .nothrow();
    if (memResult.exitCode === 0) {
      const [total, used] = memResult.text().trim().split(/\s+/);
      memory_total_mb = parseInt(total, 10) || 0;
      memory_mb = parseInt(used, 10) || 0;
    } else {
      // macOS fallback using sysctl
      const macMem = await Bun.$`sysctl -n hw.memsize 2>/dev/null`
        .quiet()
        .nothrow();
      memory_total_mb = parseInt(macMem.text().trim(), 10) / (1024 * 1024) || 0;
      const macUsed = await Bun.$`vm_stat | grep "Pages active" | awk '{print $3}' | tr -d '.'`
        .quiet()
        .nothrow();
      memory_mb = (parseInt(macUsed.text().trim(), 10) * 4096) / (1024 * 1024) || 0;
    }

    // Get disk usage from df
    let disk_mb = 0;
    let disk_total_mb = 0;
    const diskResult = await Bun.$`df -m / 2>/dev/null | tail -1 | awk '{print $2,$3}'`
      .quiet()
      .nothrow();
    if (diskResult.exitCode === 0) {
      const [total, used] = diskResult.text().trim().split(/\s+/);
      disk_total_mb = parseInt(total, 10) || 0;
      disk_mb = parseInt(used, 10) || 0;
    }

    // Get load average
    let load_avg: number[] = [0, 0, 0];
    const loadResult = await Bun.$`cat /proc/loadavg 2>/dev/null | awk '{print $1,$2,$3}'`
      .quiet()
      .nothrow();
    if (loadResult.exitCode === 0) {
      load_avg = loadResult.text().trim().split(/\s+/).map(v => parseFloat(v) || 0);
    } else {
      const macLoad = await Bun.$`sysctl -n vm.loadavg 2>/dev/null`
        .quiet()
        .nothrow();
      const match = macLoad.text().match(/[\d.]+/g);
      if (match) load_avg = match.slice(0, 3).map(v => parseFloat(v) || 0);
    }

    return { cpu_percent, memory_mb, memory_total_mb, disk_mb, disk_total_mb, load_avg };
  } catch {
    return { cpu_percent: 0, memory_mb: 0, memory_total_mb: 0, disk_mb: 0, disk_total_mb: 0, load_avg: [0, 0, 0] };
  }
}

/**
 * Collect metrics for all running databases
 */
export async function collectAllMetrics(): Promise<number> {
  initMetricsDb();

  const databases = await getAllDatabases();
  const timestamp = Date.now();
  let collected = 0;

  for (const db of databases) {
    try {
      const status = await getContainerStatus(db.name);

      if (status !== "running") {
        continue;
      }

      // Get stats directly from PostgreSQL (with Docker fallback)
      const stats = await getPostgresStats(db.name, db.database);

      const metrics: MetricPoint = {
        timestamp,
        database: db.name,
        cpu_percent: stats.cpu_percent,
        memory_mb: stats.memory_mb,
        connections: stats.connections,
        disk_mb: stats.disk_mb,
      };

      recordMetrics(metrics);
      collected++;
    } catch (err) {
      // Silently skip databases that can't be measured
      console.error(`Failed to collect metrics for ${db.name}:`, err);
    }
  }

  updateLastCollectionTime();

  // Clean up old metrics deterministically every N collections
  collectionCount++;
  if (collectionCount >= CLEANUP_EVERY_N_COLLECTIONS) {
    collectionCount = 0; // Reset counter to prevent overflow
    cleanupOldMetrics(30);
  }

  return collected;
}

/**
 * Collect metrics for a single database
 */
export async function collectDatabaseMetrics(dbName: string): Promise<MetricPoint | null> {
  initMetricsDb();

  const databases = await getAllDatabases();
  const db = databases.find(d => d.name === dbName);

  if (!db) {
    return null;
  }

  const status = await getContainerStatus(db.name);

  if (status !== "running") {
    return null;
  }

  const timestamp = Date.now();
  const stats = await getPostgresStats(db.name, db.database);

  const metrics: MetricPoint = {
    timestamp,
    database: db.name,
    cpu_percent: stats.cpu_percent,
    memory_mb: stats.memory_mb,
    connections: stats.connections,
    disk_mb: stats.disk_mb,
  };

  recordMetrics(metrics);
  updateLastCollectionTime();

  return metrics;
}

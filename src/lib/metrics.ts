import { Database, Statement } from "bun:sqlite";
import { FILES } from "./constants";

const METRICS_DB_PATH = FILES.metricsDb;

export interface MetricPoint {
  timestamp: number;
  database: string;
  cpu_percent: number;
  memory_mb: number;
  connections: number;
  disk_mb: number;
}

export interface AggregatedMetrics {
  timestamp: number;
  cpu_percent: number;
  memory_mb: number;
  connections: number;
  disk_mb: number;
}

let db: Database | null = null;

// Cached prepared statements to prevent leaks and improve performance
let insertMetricsStmt: Statement | null = null;
let updateCollectionTimeStmt: Statement | null = null;
let getCollectionTimeStmt: Statement | null = null;
let cleanupMetricsStmt: Statement | null = null;

/**
 * Initialize the metrics database
 */
export function initMetricsDb(): Database {
  if (db) return db;

  db = new Database(METRICS_DB_PATH, { create: true });

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      database TEXT NOT NULL,
      cpu_percent REAL DEFAULT 0,
      memory_mb REAL DEFAULT 0,
      connections INTEGER DEFAULT 0,
      disk_mb REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metrics_database ON metrics(database)
  `);

  // Create table for tracking collection status
  db.run(`
    CREATE TABLE IF NOT EXISTS collection_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_collection INTEGER,
      is_running INTEGER DEFAULT 0
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO collection_status (id, last_collection, is_running) VALUES (1, 0, 0)
  `);

  return db;
}

/**
 * Record metrics for a database
 */
export function recordMetrics(metrics: MetricPoint): void {
  const database = initMetricsDb();

  // Use cached prepared statement
  if (!insertMetricsStmt) {
    insertMetricsStmt = database.prepare(`
      INSERT INTO metrics (timestamp, database, cpu_percent, memory_mb, connections, disk_mb)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  insertMetricsStmt.run(
    metrics.timestamp,
    metrics.database,
    metrics.cpu_percent,
    metrics.memory_mb,
    metrics.connections,
    metrics.disk_mb
  );
}

/**
 * Get metrics for a specific time range
 */
export function getMetrics(
  startTime: number,
  endTime: number,
  dbName?: string,
  granularity: "minute" | "hour" | "day" = "minute"
): AggregatedMetrics[] {
  const database = initMetricsDb();

  // Determine bucket size based on granularity
  let bucketSize: number;
  switch (granularity) {
    case "minute":
      bucketSize = 60 * 1000; // 1 minute
      break;
    case "hour":
      bucketSize = 60 * 60 * 1000; // 1 hour
      break;
    case "day":
      bucketSize = 24 * 60 * 60 * 1000; // 1 day
      break;
  }

  let query: string;
  let params: (number | string)[];

  if (dbName) {
    query = `
      SELECT
        (timestamp / ?) * ? as timestamp,
        AVG(cpu_percent) as cpu_percent,
        AVG(memory_mb) as memory_mb,
        SUM(connections) as connections,
        AVG(disk_mb) as disk_mb
      FROM metrics
      WHERE timestamp >= ? AND timestamp <= ? AND database = ?
      GROUP BY timestamp / ?
      ORDER BY timestamp ASC
    `;
    params = [bucketSize, bucketSize, startTime, endTime, dbName, bucketSize];
  } else {
    // When aggregating across all databases, we need to first get the latest value per database per bucket,
    // then sum those values (not sum all raw data points which inflates the numbers)
    query = `
      SELECT
        bucket_ts as timestamp,
        AVG(cpu_percent) as cpu_percent,
        SUM(memory_mb) as memory_mb,
        SUM(connections) as connections,
        SUM(disk_mb) as disk_mb
      FROM (
        SELECT
          (timestamp / ?) * ? as bucket_ts,
          database,
          AVG(cpu_percent) as cpu_percent,
          AVG(memory_mb) as memory_mb,
          MAX(connections) as connections,
          AVG(disk_mb) as disk_mb
        FROM metrics
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY bucket_ts, database
      )
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `;
    params = [bucketSize, bucketSize, startTime, endTime];
  }

  const stmt = database.prepare(query);
  return stmt.all(...params) as AggregatedMetrics[];
}

/**
 * Get metrics for specific periods
 */
export function getMetricsForPeriod(
  period: "1h" | "24h" | "7d" | "30d" | "all",
  dbName?: string
): AggregatedMetrics[] {
  const now = Date.now();
  let startTime: number;
  let granularity: "minute" | "hour" | "day";

  switch (period) {
    case "1h":
      startTime = now - 60 * 60 * 1000;
      granularity = "minute";
      break;
    case "24h":
      startTime = now - 24 * 60 * 60 * 1000;
      granularity = "minute";
      break;
    case "7d":
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      granularity = "hour";
      break;
    case "30d":
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      granularity = "day";
      break;
    case "all":
    default:
      startTime = 0; // All time
      granularity = "day";
      break;
  }

  return getMetrics(startTime, now, dbName, granularity);
}

export interface PerDatabaseMetrics {
  database: string;
  metrics: AggregatedMetrics[];
}

/**
 * Get metrics grouped by database for multi-line charts
 * Returns an array of per-database metrics plus a "total" entry
 */
export function getMetricsGroupedByDatabase(
  period: "1h" | "24h" | "7d" | "30d" | "all"
): { databases: PerDatabaseMetrics[]; total: AggregatedMetrics[] } {
  const database = initMetricsDb();
  const now = Date.now();
  let startTime: number;
  let bucketSize: number;

  switch (period) {
    case "1h":
      startTime = now - 60 * 60 * 1000;
      bucketSize = 60 * 1000; // 1 minute
      break;
    case "24h":
      startTime = now - 24 * 60 * 60 * 1000;
      bucketSize = 60 * 1000; // 1 minute
      break;
    case "7d":
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      bucketSize = 60 * 60 * 1000; // 1 hour
      break;
    case "30d":
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      bucketSize = 24 * 60 * 60 * 1000; // 1 day
      break;
    case "all":
    default:
      startTime = 0; // All time
      bucketSize = 24 * 60 * 60 * 1000; // 1 day
      break;
  }

  // Get list of all databases in the time range
  const dbListStmt = database.prepare(`
    SELECT DISTINCT database FROM metrics
    WHERE timestamp >= ? AND timestamp <= ?
  `);
  const dbList = dbListStmt.all(startTime, now) as { database: string }[];

  // Get metrics for each database
  const perDbStmt = database.prepare(`
    SELECT
      (timestamp / ?) * ? as timestamp,
      AVG(cpu_percent) as cpu_percent,
      AVG(memory_mb) as memory_mb,
      SUM(connections) as connections,
      AVG(disk_mb) as disk_mb
    FROM metrics
    WHERE timestamp >= ? AND timestamp <= ? AND database = ?
    GROUP BY timestamp / ?
    ORDER BY timestamp ASC
  `);

  const databases: PerDatabaseMetrics[] = dbList.map(({ database: dbName }) => ({
    database: dbName,
    metrics: perDbStmt.all(bucketSize, bucketSize, startTime, now, dbName, bucketSize) as AggregatedMetrics[],
  }));

  // Get total (aggregated across all databases)
  // First average per database per bucket, then sum across databases to avoid inflated values
  const totalStmt = database.prepare(`
    SELECT
      bucket_ts as timestamp,
      AVG(cpu_percent) as cpu_percent,
      SUM(memory_mb) as memory_mb,
      SUM(connections) as connections,
      SUM(disk_mb) as disk_mb
    FROM (
      SELECT
        (timestamp / ?) * ? as bucket_ts,
        database,
        AVG(cpu_percent) as cpu_percent,
        AVG(memory_mb) as memory_mb,
        MAX(connections) as connections,
        AVG(disk_mb) as disk_mb
      FROM metrics
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY bucket_ts, database
    )
    GROUP BY bucket_ts
    ORDER BY bucket_ts ASC
  `);
  const total = totalStmt.all(bucketSize, bucketSize, startTime, now) as AggregatedMetrics[];

  return { databases, total };
}

/**
 * Clean up old metrics (keep last 30 days)
 */
export function cleanupOldMetrics(daysToKeep = 30): number {
  const database = initMetricsDb();
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  // Use cached prepared statement
  if (!cleanupMetricsStmt) {
    cleanupMetricsStmt = database.prepare(`DELETE FROM metrics WHERE timestamp < ?`);
  }

  const result = cleanupMetricsStmt.run(cutoff);
  return result.changes;
}

/**
 * Get the last collection timestamp
 */
export function getLastCollectionTime(): number {
  const database = initMetricsDb();

  // Use cached prepared statement
  if (!getCollectionTimeStmt) {
    getCollectionTimeStmt = database.prepare(`SELECT last_collection FROM collection_status WHERE id = 1`);
  }

  const result = getCollectionTimeStmt.get() as { last_collection: number } | null;
  return result?.last_collection || 0;
}

/**
 * Update the last collection timestamp
 */
export function updateLastCollectionTime(): void {
  const database = initMetricsDb();

  // Use cached prepared statement
  if (!updateCollectionTimeStmt) {
    updateCollectionTimeStmt = database.prepare(`UPDATE collection_status SET last_collection = ? WHERE id = 1`);
  }

  updateCollectionTimeStmt.run(Date.now());
}

/**
 * Close the database connection and finalize statements
 */
export function closeMetricsDb(): void {
  // Finalize all prepared statements
  if (insertMetricsStmt) {
    insertMetricsStmt.finalize();
    insertMetricsStmt = null;
  }
  if (updateCollectionTimeStmt) {
    updateCollectionTimeStmt.finalize();
    updateCollectionTimeStmt = null;
  }
  if (getCollectionTimeStmt) {
    getCollectionTimeStmt.finalize();
    getCollectionTimeStmt = null;
  }
  if (cleanupMetricsStmt) {
    cleanupMetricsStmt.finalize();
    cleanupMetricsStmt = null;
  }

  // Close database connection
  if (db) {
    db.close();
    db = null;
  }
}

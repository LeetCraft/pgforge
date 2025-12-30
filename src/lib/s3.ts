/**
 * S3 Backup Module for PgForge
 *
 * URL Format: s3://accessKeyId:secretAccessKey@endpoint/bucket?region=auto
 *
 * Examples:
 *   s3://AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY@s3.amazonaws.com/my-backups?region=us-east-1
 *   s3://key:secret@nyc3.digitaloceanspaces.com/pgforge-backups?region=nyc3
 *   s3://key:secret@s3.eu-central-1.amazonaws.com/my-bucket?region=eu-central-1
 *   s3://key:secret@endpoint.r2.cloudflarestorage.com/bucket?region=auto
 */

import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { PATHS } from "./constants";
import { join } from "path";

// =============================================================================
// TYPES
// =============================================================================

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region: string;
  enabled: boolean;
  intervalHours: number; // Backup interval in hours (default: 24)
  lastBackup: string | null; // ISO timestamp of last backup
}

export interface S3BackupInfo {
  key: string;
  database: string;
  timestamp: Date;
  size: number;
}

// =============================================================================
// FILES
// =============================================================================

const S3_CONFIG_FILE = join(PATHS.config, "s3.json");

// =============================================================================
// URL PARSING
// =============================================================================

/**
 * Parse S3 URL into config
 *
 * Format: s3://accessKeyId:secretAccessKey@endpoint/bucket?region=auto
 */
export function parseS3Url(url: string): Omit<S3Config, "enabled" | "intervalHours" | "lastBackup"> {
  if (!url.startsWith("s3://")) {
    throw new Error("Invalid S3 URL. Must start with s3://");
  }

  // Remove s3:// prefix
  const withoutProtocol = url.slice(5);

  // Parse credentials and rest
  const atIndex = withoutProtocol.indexOf("@");
  if (atIndex === -1) {
    throw new Error("Invalid S3 URL. Must contain @ to separate credentials from endpoint");
  }

  const credentials = withoutProtocol.slice(0, atIndex);
  const endpointAndPath = withoutProtocol.slice(atIndex + 1);

  // Parse accessKeyId:secretAccessKey
  const colonIndex = credentials.indexOf(":");
  if (colonIndex === -1) {
    throw new Error("Invalid S3 URL. Credentials must be in format accessKeyId:secretAccessKey");
  }

  const accessKeyId = decodeURIComponent(credentials.slice(0, colonIndex));
  const secretAccessKey = decodeURIComponent(credentials.slice(colonIndex + 1));

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Invalid S3 URL. Both accessKeyId and secretAccessKey are required");
  }

  // Parse endpoint/bucket?region=xxx
  const questionIndex = endpointAndPath.indexOf("?");
  const pathPart = questionIndex === -1 ? endpointAndPath : endpointAndPath.slice(0, questionIndex);
  const queryPart = questionIndex === -1 ? "" : endpointAndPath.slice(questionIndex + 1);

  // Parse endpoint and bucket from path
  const slashIndex = pathPart.indexOf("/");
  if (slashIndex === -1) {
    throw new Error("Invalid S3 URL. Must contain /bucket after endpoint");
  }

  const endpoint = pathPart.slice(0, slashIndex);
  const bucket = pathPart.slice(slashIndex + 1).replace(/\/$/, ""); // Remove trailing slash

  if (!endpoint || !bucket) {
    throw new Error("Invalid S3 URL. Both endpoint and bucket are required");
  }

  // Parse region from query string
  let region = "auto";
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    region = params.get("region") || "auto";
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    region,
  };
}

/**
 * Format S3 config back to URL (for display, masks secret)
 */
export function formatS3Url(config: S3Config, maskSecret = true): string {
  const secret = maskSecret ? "****" : config.secretAccessKey;
  return `s3://${config.accessKeyId}:${secret}@${config.endpoint}/${config.bucket}?region=${config.region}`;
}

// =============================================================================
// CONFIG MANAGEMENT
// =============================================================================

/**
 * Get S3 config
 */
export async function getS3Config(): Promise<S3Config | null> {
  try {
    const file = Bun.file(S3_CONFIG_FILE);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return null;
}

/**
 * Save S3 config
 */
export async function saveS3Config(config: S3Config): Promise<void> {
  await Bun.write(S3_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Delete S3 config
 */
export async function deleteS3Config(): Promise<void> {
  await Bun.$`rm -f ${S3_CONFIG_FILE}`.quiet().nothrow();
}

// =============================================================================
// S3 CLIENT
// =============================================================================

/**
 * Create S3 client from config
 */
function createS3Client(config: S3Config): S3Client {
  const endpointUrl = config.endpoint.startsWith("http")
    ? config.endpoint
    : `https://${config.endpoint}`;

  return new S3Client({
    endpoint: endpointUrl,
    region: config.region === "auto" ? "us-east-1" : config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true, // Required for R2 and most S3-compatible providers
  });
}

// =============================================================================
// S3 OPERATIONS
// =============================================================================

/**
 * Test S3 connection
 */
export async function testS3Connection(config: S3Config): Promise<{ success: boolean; error?: string }> {
  const client = createS3Client(config);

  try {
    // Try to head the bucket to verify access
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { success: true };
  } catch (err: any) {
    // Parse common errors
    const errorName = err.name || err.Code || "";
    const errorMessage = err.message || "";

    if (errorName === "InvalidAccessKeyId" || errorMessage.includes("InvalidAccessKeyId")) {
      return { success: false, error: "Invalid access key ID" };
    }
    if (errorName === "SignatureDoesNotMatch" || errorMessage.includes("SignatureDoesNotMatch")) {
      return { success: false, error: "Invalid secret access key" };
    }
    if (errorName === "NoSuchBucket" || errorMessage.includes("NoSuchBucket")) {
      return { success: false, error: "Bucket does not exist" };
    }
    if (errorName === "AccessDenied" || errorMessage.includes("AccessDenied")) {
      return { success: false, error: "Access denied - check permissions" };
    }
    if (errorName === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return { success: false, error: "Bucket not found" };
    }

    return { success: false, error: errorMessage.slice(0, 200) || "Connection failed" };
  } finally {
    client.destroy();
  }
}

/**
 * Upload backup to S3
 */
export async function uploadBackupToS3(
  config: S3Config,
  databaseName: string,
  backupData: Buffer
): Promise<{ success: boolean; key?: string; error?: string }> {
  const client = createS3Client(config);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-"); // HH-MM-SS

  // Key format: database-name/YYYY-MM-DD/database-name-YYYY-MM-DD-HH-MM-SS.epg
  const key = `${databaseName}/${dateStr}/${databaseName}-${dateStr}-${timeStr}.epg`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: backupData,
        ContentType: "application/octet-stream",
      })
    );

    return { success: true, key };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) || "Upload failed" };
  } finally {
    client.destroy();
  }
}

/**
 * List backups in S3 for a specific database
 */
export async function listS3Backups(
  config: S3Config,
  databaseName?: string
): Promise<{ success: boolean; backups?: S3BackupInfo[]; error?: string }> {
  const client = createS3Client(config);

  try {
    const prefix = databaseName ? `${databaseName}/` : "";

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
      })
    );

    const backups: S3BackupInfo[] = [];

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Key.endsWith(".epg")) {
          // Extract database name from key (format: database-name/date/database-name-date-time.epg)
          const dbName = obj.Key.split("/")[0];
          backups.push({
            key: obj.Key,
            database: dbName,
            timestamp: obj.LastModified || new Date(),
            size: obj.Size || 0,
          });
        }
      }
    }

    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return { success: true, backups };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) || "List failed" };
  } finally {
    client.destroy();
  }
}

/**
 * Download backup from S3
 */
export async function downloadBackupFromS3(
  config: S3Config,
  key: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  const client = createS3Client(config);

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

    if (response.Body) {
      // Convert stream to buffer and write to file
      const chunks: Uint8Array[] = [];
      const reader = response.Body.transformToWebStream().getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const buffer = Buffer.concat(chunks);
      await Bun.write(outputPath, buffer);

      return { success: true };
    }

    return { success: false, error: "Empty response body" };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) || "Download failed" };
  } finally {
    client.destroy();
  }
}

/**
 * Delete backup from S3
 */
export async function deleteBackupFromS3(
  config: S3Config,
  key: string
): Promise<{ success: boolean; error?: string }> {
  const client = createS3Client(config);

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) || "Delete failed" };
  } finally {
    client.destroy();
  }
}

// =============================================================================
// BACKUP CREATION (reuses existing backup logic)
// =============================================================================

/**
 * Create backup for a database (returns raw backup data)
 */
export async function createDatabaseBackup(databaseName: string): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  const { getState } = await import("./fs");
  const { getContainerStatus, getDockerPath } = await import("./docker");

  try {
    const state = await getState();
    const db = state.databases[databaseName];

    if (!db) {
      return { success: false, error: `Database "${databaseName}" not found` };
    }

    // Check if running
    const status = await getContainerStatus(databaseName);
    if (status !== "running") {
      return { success: false, error: `Database "${databaseName}" is not running` };
    }

    // Create SQL dump
    const d = await getDockerPath();
    const dumpResult = await Bun.$`${{ raw: d }} exec pgforge-${databaseName}-pg pg_dump -U pgadmin ${db.database}`.quiet().nothrow();

    if (dumpResult.exitCode !== 0) {
      return { success: false, error: "Failed to create database dump" };
    }

    const sqlDump = dumpResult.text();

    // Create metadata
    const metadata = {
      version: 1,
      name: db.name,
      database: db.database,
      username: db.username,
      password: db.password,
      adminPassword: db.adminPassword || db.password,
      pgVersion: db.pgVersion,
      poolerEnabled: db.poolerEnabled,
      createdAt: db.createdAt,
      exportedAt: new Date().toISOString(),
      encrypted: false,
    };

    // Create archive structure
    const metadataJson = JSON.stringify(metadata, null, 2);
    const separator = "\0PGFORGE_DATA\0";
    const archiveContent = metadataJson + separator + sqlDump;

    // Compress with gzip
    const compressed = Bun.gzipSync(Buffer.from(archiveContent));

    // Add magic header
    const header = Buffer.from("PGFORGE01");
    const flags = Buffer.alloc(1);
    flags[0] = 0; // not encrypted

    const output = Buffer.concat([header, flags, compressed]);

    return { success: true, data: output };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run scheduled backup for all databases
 */
export async function runScheduledBackup(): Promise<{
  success: boolean;
  backed: string[];
  failed: { name: string; error: string }[];
}> {
  const config = await getS3Config();

  if (!config || !config.enabled) {
    return { success: false, backed: [], failed: [] };
  }

  const { getAllDatabases } = await import("./fs");
  const databases = await getAllDatabases();

  const backed: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const db of databases) {
    // Create backup
    const backupResult = await createDatabaseBackup(db.name);

    if (!backupResult.success || !backupResult.data) {
      failed.push({ name: db.name, error: backupResult.error || "Unknown error" });
      continue;
    }

    // Upload to S3
    const uploadResult = await uploadBackupToS3(config, db.name, backupResult.data);

    if (uploadResult.success) {
      backed.push(db.name);
    } else {
      failed.push({ name: db.name, error: uploadResult.error || "Upload failed" });
    }
  }

  // Update last backup time
  config.lastBackup = new Date().toISOString();
  await saveS3Config(config);

  return { success: true, backed, failed };
}

/**
 * Check if scheduled backup is due
 */
export async function isBackupDue(): Promise<boolean> {
  const config = await getS3Config();

  if (!config || !config.enabled) {
    return false;
  }

  if (!config.lastBackup) {
    return true; // Never backed up
  }

  const lastBackupTime = new Date(config.lastBackup).getTime();
  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  const nextBackupTime = lastBackupTime + intervalMs;

  return Date.now() >= nextBackupTime;
}

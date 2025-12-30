/**
 * S3 Backup Commands
 *
 * URL Format: s3://accessKeyId:secretAccessKey@endpoint/bucket?region=auto
 *
 * Examples:
 *   s3://AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI@s3.amazonaws.com/my-backups?region=us-east-1
 *   s3://key:secret@nyc3.digitaloceanspaces.com/pgforge-backups?region=nyc3
 *   s3://key:secret@s3.eu-west-1.amazonaws.com/my-bucket?region=eu-west-1
 *   s3://key:secret@endpoint.r2.cloudflarestorage.com/bucket?region=auto
 */

import * as ui from "../lib/ui";
import {
  parseS3Url,
  formatS3Url,
  getS3Config,
  saveS3Config,
  deleteS3Config,
  testS3Connection,
  listS3Backups,
  uploadBackupToS3,
  downloadBackupFromS3,
  createDatabaseBackup,
  runScheduledBackup,
  type S3Config,
} from "../lib/s3";
import { restore as restoreDatabase } from "./restore";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Configure S3 backup with URL
 */
export async function s3Configure(url: string, options: { interval?: string }): Promise<void> {
  const spin = ui.spinner("Parsing S3 URL...");
  spin.start();

  try {
    // Parse URL
    const parsed = parseS3Url(url);

    spin.text = "Testing S3 connection...";

    // Build full config
    const config: S3Config = {
      ...parsed,
      enabled: true,
      intervalHours: options.interval ? parseInt(options.interval, 10) : 24,
      lastBackup: null,
    };

    // Validate interval
    if (config.intervalHours < 1 || config.intervalHours > 168) {
      spin.fail("Interval must be between 1 and 168 hours");
      return;
    }

    // Test connection
    const testResult = await testS3Connection(config);

    if (!testResult.success) {
      spin.fail(`S3 connection failed: ${testResult.error}`);
      return;
    }

    // Save config
    await saveS3Config(config);

    spin.succeed("S3 backup configured successfully");

    console.log();
    ui.printKeyValue("Endpoint", config.endpoint);
    ui.printKeyValue("Bucket", config.bucket);
    ui.printKeyValue("Region", config.region);
    ui.printKeyValue("Interval", `${config.intervalHours} hours`);
    console.log();
    ui.success("Automatic backups enabled");
    ui.info("Backups will run via the daemon at the configured interval");
  } catch (err) {
    spin.fail(`Failed to configure S3: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Set backup interval
 */
export async function s3Interval(hours: string): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.error("S3 backup not configured");
    ui.info("Run 'pgforge s3 configure <url>' first");
    process.exit(1);
  }

  const intervalHours = parseInt(hours, 10);

  if (isNaN(intervalHours) || intervalHours < 1 || intervalHours > 168) {
    ui.error("Interval must be between 1 and 168 hours");
    process.exit(1);
  }

  config.intervalHours = intervalHours;
  await saveS3Config(config);

  ui.success(`Backup interval set to ${intervalHours} hours`);
}

/**
 * Show S3 backup status
 */
export async function s3Status(): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.muted("S3 backup not configured");
    console.log();
    ui.info("Configure with: pgforge s3 configure <url>");
    ui.info("URL format: s3://accessKeyId:secretAccessKey@endpoint/bucket?region=auto");
    return;
  }

  console.log();
  ui.printKeyValue("Status", config.enabled ? "Enabled" : "Disabled");
  ui.printKeyValue("Endpoint", config.endpoint);
  ui.printKeyValue("Bucket", config.bucket);
  ui.printKeyValue("Region", config.region);
  ui.printKeyValue("Interval", `${config.intervalHours} hours`);

  if (config.lastBackup) {
    const lastBackup = new Date(config.lastBackup);
    const nextBackup = new Date(lastBackup.getTime() + config.intervalHours * 60 * 60 * 1000);
    const ago = Math.floor((Date.now() - lastBackup.getTime()) / 1000 / 60);

    ui.printKeyValue("Last backup", `${ago} minutes ago`);
    ui.printKeyValue("Next backup", nextBackup > new Date() ? `in ${Math.floor((nextBackup.getTime() - Date.now()) / 1000 / 60)} minutes` : "now");
  } else {
    ui.printKeyValue("Last backup", "Never");
    ui.printKeyValue("Next backup", "Pending (will run soon)");
  }

  console.log();

  // Test connection
  const spin = ui.spinner("Testing connection...");
  spin.start();

  const testResult = await testS3Connection(config);

  if (testResult.success) {
    spin.succeed("S3 connection is healthy");
  } else {
    spin.fail(`S3 connection failed: ${testResult.error}`);
  }
}

/**
 * Disable S3 backup
 */
export async function s3Disable(): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.muted("S3 backup is not configured");
    return;
  }

  config.enabled = false;
  await saveS3Config(config);

  ui.success("S3 backup disabled");
  ui.info("Your configuration is preserved. Re-enable with 'pgforge s3 enable'");
}

/**
 * Enable S3 backup (if previously configured)
 */
export async function s3Enable(): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.error("S3 backup not configured");
    ui.info("Run 'pgforge s3 configure <url>' first");
    process.exit(1);
  }

  config.enabled = true;
  await saveS3Config(config);

  ui.success("S3 backup enabled");
}

/**
 * Remove S3 configuration completely
 */
export async function s3Remove(): Promise<void> {
  await deleteS3Config();
  ui.success("S3 backup configuration removed");
}

/**
 * Run backup manually
 */
export async function s3Backup(options: { name?: string }): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.error("S3 backup not configured");
    ui.info("Run 'pgforge s3 configure <url>' first");
    process.exit(1);
  }

  if (options.name) {
    // Backup single database
    const spin = ui.spinner(`Backing up ${options.name}...`);
    spin.start();

    const backupResult = await createDatabaseBackup(options.name);

    if (!backupResult.success || !backupResult.data) {
      spin.fail(`Backup failed: ${backupResult.error}`);
      process.exit(1);
    }

    spin.text = "Uploading to S3...";

    const uploadResult = await uploadBackupToS3(config, options.name, backupResult.data);

    if (!uploadResult.success) {
      spin.fail(`Upload failed: ${uploadResult.error}`);
      process.exit(1);
    }

    spin.succeed(`Backed up ${options.name}`);
    ui.printKeyValue("S3 Key", uploadResult.key!);
  } else {
    // Backup all databases
    const spin = ui.spinner("Backing up all databases...");
    spin.start();

    const result = await runScheduledBackup();

    if (result.backed.length > 0) {
      spin.succeed(`Backed up ${result.backed.length} database(s)`);
      for (const name of result.backed) {
        ui.success(`  ✓ ${name}`);
      }
    }

    if (result.failed.length > 0) {
      if (result.backed.length === 0) {
        spin.fail("All backups failed");
      }
      for (const { name, error } of result.failed) {
        ui.error(`  ✗ ${name}: ${error}`);
      }
    }

    if (result.backed.length === 0 && result.failed.length === 0) {
      spin.info("No databases to backup");
    }
  }
}

/**
 * List backups in S3
 */
export async function s3List(options: { name?: string }): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.error("S3 backup not configured");
    ui.info("Run 'pgforge s3 configure <url>' first");
    process.exit(1);
  }

  const spin = ui.spinner("Listing backups...");
  spin.start();

  const result = await listS3Backups(config, options.name);

  if (!result.success) {
    spin.fail(`Failed to list backups: ${result.error}`);
    process.exit(1);
  }

  spin.stop();

  const backups = result.backups || [];

  if (backups.length === 0) {
    if (options.name) {
      ui.muted(`No backups found for database "${options.name}"`);
    } else {
      ui.muted("No backups found");
    }
    return;
  }

  console.log();

  // Group by database
  const byDatabase = new Map<string, typeof backups>();
  for (const backup of backups) {
    if (!byDatabase.has(backup.database)) {
      byDatabase.set(backup.database, []);
    }
    byDatabase.get(backup.database)!.push(backup);
  }

  for (const [db, dbBackups] of byDatabase) {
    ui.printSection(db);

    for (const backup of dbBackups.slice(0, 10)) {
      const sizeStr = formatBytes(backup.size);
      const dateStr = backup.timestamp.toLocaleString();
      console.log(`  ${backup.key}`);
      ui.muted(`    ${dateStr} (${sizeStr})`);
    }

    if (dbBackups.length > 10) {
      ui.muted(`  ... and ${dbBackups.length - 10} more`);
    }

    console.log();
  }

  ui.info(`Total: ${backups.length} backup(s)`);
}

/**
 * Restore from S3 backup
 */
export async function s3Restore(options: { key: string; name?: string }): Promise<void> {
  const config = await getS3Config();

  if (!config) {
    ui.error("S3 backup not configured");
    ui.info("Run 'pgforge s3 configure <url>' first");
    process.exit(1);
  }

  const spin = ui.spinner("Downloading backup from S3...");
  spin.start();

  // Download to temp file
  const tempFile = join(tmpdir(), `pgforge-s3-restore-${Date.now()}.epg`);

  try {
    const downloadResult = await downloadBackupFromS3(config, options.key, tempFile);

    if (!downloadResult.success) {
      spin.fail(`Download failed: ${downloadResult.error}`);
      process.exit(1);
    }

    spin.succeed("Downloaded backup");

    // Use existing restore command
    await restoreDatabase({ path: tempFile, name: options.name });
  } finally {
    // Clean up temp file
    await Bun.$`rm -f ${tempFile}`.quiet().nothrow();
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

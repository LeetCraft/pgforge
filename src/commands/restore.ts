import { getState, saveState, getDatabasePath, ensureDatabaseDir } from "../lib/fs";
import { startDatabase, getContainerStatus, destroyDatabase, getDockerPath } from "../lib/docker";
import { generateComposeFile, generateInitScript } from "../lib/compose";
import { allocatePort } from "../lib/ports";
import * as ui from "../lib/ui";

interface RestoreOptions {
  path: string;
  name?: string; // Optional: override database name
}

interface ArchiveMetadata {
  version: number;
  name: string;
  database: string;
  username: string;
  password: string;
  adminPassword: string;
  pgVersion: string;
  poolerEnabled: boolean;
  createdAt: string;
  exportedAt: string;
  encrypted: boolean;
}

async function promptForPassword(): Promise<string> {
  const { default: inquirer } = await import("inquirer");
  const { password } = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      message: "Enter decryption password:",
    },
  ]);
  return password || "";
}

async function decryptData(data: Buffer, password: string): Promise<Buffer> {
  const encoder = new TextEncoder();

  // Extract salt (16 bytes), iv (12 bytes), and encrypted data
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 28);
  const encryptedData = data.subarray(28);

  // Derive key from password
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Decrypt the data
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedData
  );

  return Buffer.from(decrypted);
}

export async function restore(options: RestoreOptions): Promise<void> {
  if (!options.path) {
    ui.error("Path is required. Use --path to specify the backup file.");
    ui.info("Example: pgforge restore --path ./mydb-backup.epg");
    process.exit(1);
  }

  // Verify file exists
  const file = Bun.file(options.path);
  if (!(await file.exists())) {
    ui.error(`Backup file not found: ${options.path}`);
    process.exit(1);
  }

  const spin = ui.spinner("Reading backup file...");
  spin.start();

  try {
    // 1. Read and parse the archive
    const rawData = Buffer.from(await file.arrayBuffer());

    // Check magic header
    const header = rawData.subarray(0, 8).toString();
    if (header !== "PGFORGE01" && header !== "EASYPG01") {
      spin.fail("Invalid backup file");
      ui.error("This file is not a valid PgForge backup archive.");
      process.exit(1);
    }

    // Check flags
    const flags = rawData[8];
    const isEncrypted = (flags & 1) === 1;

    let compressedData = rawData.subarray(9);

    // 2. Decrypt if needed
    if (isEncrypted) {
      spin.stop();
      const password = await promptForPassword();
      spin.start();
      spin.text = "Decrypting...";

      try {
        compressedData = await decryptData(compressedData, password);
      } catch {
        spin.fail("Decryption failed");
        ui.error("Invalid password or corrupted backup file.");
        process.exit(1);
      }
    }

    // 3. Decompress
    spin.text = "Decompressing...";
    const decompressed = Bun.gunzipSync(compressedData);
    const archiveContent = Buffer.from(decompressed).toString("utf8");

    // 4. Parse metadata and SQL dump
    const separator = archiveContent.includes("\0PGFORGE_DATA\0") ? "\0PGFORGE_DATA\0" : "\0EASYPG_DATA\0";
    const separatorIndex = archiveContent.indexOf(separator);
    if (separatorIndex === -1) {
      spin.fail("Invalid backup file");
      ui.error("Backup file is corrupted or in an unsupported format.");
      process.exit(1);
    }

    const metadataJson = archiveContent.substring(0, separatorIndex);
    const sqlDump = archiveContent.substring(separatorIndex + separator.length);

    const metadata: ArchiveMetadata = JSON.parse(metadataJson);

    spin.stop();

    // 5. Display backup info
    ui.printSectionBox("Backup Information", [
      { label: "Original Name", value: metadata.name, color: "white" },
      { label: "Database", value: metadata.database, color: "white" },
      { label: "Username", value: metadata.username, color: "white" },
      { label: "PostgreSQL", value: metadata.pgVersion, color: "muted" },
      { label: "Created", value: new Date(metadata.createdAt).toLocaleString(), color: "muted" },
      { label: "Exported", value: new Date(metadata.exportedAt).toLocaleString(), color: "muted" },
    ], "📦");

    // 6. Determine target database name
    const targetName = options.name || metadata.name;
    const state = await getState();

    // Check if database exists
    if (state.databases[targetName]) {
      ui.warning(`Database "${targetName}" already exists.`);
      const confirmed = await ui.confirm("Do you want to overwrite it?");
      if (!confirmed) {
        ui.info("Restore cancelled.");
        return;
      }

      // Stop and destroy existing database
      const existingStatus = await getContainerStatus(targetName);
      if (existingStatus === "running") {
        spin.start();
        spin.text = "Stopping existing database...";
        await destroyDatabase(targetName);
        spin.stop();
      }
    } else {
      const confirmed = await ui.confirm(`Create new database "${targetName}" from backup?`);
      if (!confirmed) {
        ui.info("Restore cancelled.");
        return;
      }
    }

    spin.start();
    spin.text = "Creating database structure...";

    // 7. Allocate port
    const port = await allocatePort(targetName);

    // 8. Create database directory
    const dbPath = getDatabasePath(targetName);
    await ensureDatabaseDir(targetName);

    // 9. Generate docker-compose.yml
    const composeContent = generateComposeFile({
      name: targetName,
      port,
      username: metadata.username,
      password: metadata.password,
      database: metadata.database,
      pgVersion: metadata.pgVersion,
      enablePooler: metadata.poolerEnabled,
      adminPassword: metadata.adminPassword,
    });
    await Bun.write(`${dbPath}/docker-compose.yml`, composeContent);

    // 10. Generate init script
    const initScript = generateInitScript({
      username: metadata.username,
      password: metadata.password,
      database: metadata.database,
    });
    await Bun.$`mkdir -p ${dbPath}/init`.quiet();
    await Bun.write(`${dbPath}/init/01-create-user.sh`, initScript);
    await Bun.$`chmod +x ${dbPath}/init/01-create-user.sh`.quiet();

    // 11. Update state
    state.databases[targetName] = {
      name: targetName,
      port,
      username: metadata.username,
      password: metadata.password,
      database: metadata.database,
      status: "creating",
      createdAt: new Date().toISOString(),
      pgVersion: metadata.pgVersion,
      poolerEnabled: metadata.poolerEnabled,
      adminPassword: metadata.adminPassword,
    };
    await saveState(state);

    // 12. Start the database
    spin.text = "Starting database...";
    await startDatabase(targetName);

    // 13. Wait for database to be ready
    spin.text = "Waiting for database to be ready...";
    const d = await getDockerPath();
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(1000);
      const checkResult = await Bun.$`${{ raw: d }} exec pgforge-${targetName}-pg pg_isready -U pgadmin`.quiet().nothrow();
      if (checkResult.exitCode === 0) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      spin.fail("Database failed to start");
      ui.error("Database container started but PostgreSQL is not responding.");
      process.exit(1);
    }

    // 14. Restore the SQL dump
    spin.text = "Restoring data...";

    // Write SQL dump to temp file and restore
    const tempSqlFile = `/tmp/pgforge-restore-${Date.now()}.sql`;
    await Bun.write(tempSqlFile, sqlDump);

    await Bun.$`cat ${tempSqlFile} | docker exec -i pgforge-${targetName}-pg psql -U pgadmin ${metadata.database}`.quiet();

    // Clean up temp file
    await Bun.$`rm -f ${tempSqlFile}`.quiet();

    // 15. Update state to running
    state.databases[targetName].status = "running";
    await saveState(state);

    spin.succeed("Database restored successfully");

    // 16. Display connection info
    console.log();
    ui.success(`Database "${targetName}" restored and running`);

    ui.printSectionBox("Connection Details", [
      { label: "Port", value: String(port), color: "white" },
      { label: "Username", value: metadata.username, color: "white" },
      { label: "Password", value: metadata.password, color: "warning" },
      { label: "Database", value: metadata.database, color: "white" },
    ], "🔌");

    console.log();
    ui.muted("Use 'pgforge connect' to see full connection details.");
    console.log();
  } catch (err) {
    spin.fail("Restore failed");
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

import { getState } from "../lib/fs";
import { getContainerStatus, getDockerPath } from "../lib/docker";
import * as ui from "../lib/ui";

interface BackupOptions {
  name?: string;
  path: string;
  pass?: boolean; // When --no-pass is used, this becomes false
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
      message: "Enter encryption password (leave empty for no encryption):",
    },
  ]);

  if (password) {
    const { confirmPassword } = await inquirer.prompt([
      {
        type: "password",
        name: "confirmPassword",
        message: "Confirm encryption password:",
      },
    ]);

    if (password !== confirmPassword) {
      ui.error("Passwords do not match");
      process.exit(1);
    }
  }

  return password || "";
}

async function encryptData(data: Buffer, password: string): Promise<Buffer> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

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
    ["encrypt"]
  );

  // Encrypt the data
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  // Combine salt + iv + encrypted data
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);

  return Buffer.from(result);
}

export async function backup(options: BackupOptions): Promise<void> {
  if (!options.path) {
    ui.error("Path is required. Use --path to specify the output file.");
    ui.info("Example: pgforge backup --name mydb --path ./mydb-backup.epg");
    process.exit(1);
  }

  const state = await getState();
  const databases = Object.values(state.databases);

  if (databases.length === 0) {
    ui.info("No databases found.");
    return;
  }

  // Select database
  let dbName: string;

  if (options.name) {
    if (!state.databases[options.name]) {
      ui.error(`Database "${options.name}" not found.`);
      ui.info("Use 'pgforge list' to see all databases.");
      process.exit(1);
    }
    dbName = options.name;
  } else {
    if (databases.length === 1) {
      dbName = databases[0].name;
    } else {
      dbName = await ui.select(
        "Which database do you want to backup?",
        databases.map((db) => ({
          name: `${db.name} (${db.status})`,
          value: db.name,
        }))
      );
    }
  }

  const db = state.databases[dbName];

  // Check if running
  const status = await getContainerStatus(dbName);
  if (status !== "running") {
    ui.error(`Database "${dbName}" is not running.`);
    ui.info("Start it first with: pgforge start --name " + dbName);
    process.exit(1);
  }

  // Get encryption password (--no-pass sets options.pass to false)
  let encryptionPassword = "";
  if (options.pass !== false) {
    encryptionPassword = await promptForPassword();
  }

  console.log();
  const spin = ui.spinner(`Creating portable backup of ${dbName}...`);
  spin.start();

  try {
    // 1. Create SQL dump
    spin.text = "Dumping database...";
    const d = await getDockerPath();
    const dumpResult = await Bun.$`${{ raw: d }} exec pgforge-${dbName}-pg pg_dump -U pgadmin ${db.database}`.quiet();
    const sqlDump = dumpResult.text();

    // 2. Create metadata
    const metadata: ArchiveMetadata = {
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
      encrypted: !!encryptionPassword,
    };

    // 3. Create archive structure (JSON metadata + SQL dump separated by null byte)
    const metadataJson = JSON.stringify(metadata, null, 2);
    const separator = "\0PGFORGE_DATA\0";
    const archiveContent = metadataJson + separator + sqlDump;

    // 4. Compress with gzip
    spin.text = "Compressing...";
    const compressed = Bun.gzipSync(Buffer.from(archiveContent));

    // 5. Encrypt if password provided
    let finalData: Buffer;
    if (encryptionPassword) {
      spin.text = "Encrypting...";
      finalData = await encryptData(compressed, encryptionPassword);
    } else {
      finalData = Buffer.from(compressed);
    }

    // 6. Add magic header for file identification
    const header = Buffer.from("PGFORGE01"); // 9 bytes magic + version
    const flags = Buffer.alloc(1);
    flags[0] = encryptionPassword ? 1 : 0; // bit 0 = encrypted

    const output = Buffer.concat([header, flags, finalData]);

    // 7. Write to file
    const outputPath = options.path.endsWith(".epg") ? options.path : `${options.path}.epg`;
    await Bun.write(outputPath, output);

    spin.succeed(`Backup created successfully`);

    // Get file size
    const file = Bun.file(outputPath);
    const size = await file.size;

    ui.printSectionBox("Backup Complete", [
      { label: "Database", value: dbName, color: "white" },
      { label: "File", value: outputPath, color: "highlight" },
      { label: "Size", value: ui.formatBytes(size), color: "white" },
      { label: "Encrypted", value: encryptionPassword ? "Yes" : "No", color: encryptionPassword ? "success" : "muted" },
    ], "💾");

    console.log();
    ui.muted("Use 'pgforge restore --path <file>' to restore on any PgForge installation.");
    console.log();
  } catch (err) {
    spin.fail(`Failed to backup ${dbName}`);
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

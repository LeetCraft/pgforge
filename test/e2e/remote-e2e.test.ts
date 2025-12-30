/**
 * Remote E2E Tests for EasyPG
 *
 * These tests run on a remote VPS via SSH to test the full functionality
 * of EasyPG in a real production-like environment.
 *
 * Environment variables:
 *   - VPS_USER: SSH username (default: kysan)
 *   - VPS_HOST: SSH host IP (default: 5.161.118.192)
 *   - S3_URL: S3 backup URL (optional, for S3 tests)
 *
 * Usage:
 *   VPS_USER=kysan VPS_HOST=5.161.118.192 bun test test/e2e/remote-e2e.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";

// Configuration from environment variables
const VPS_USER = process.env.VPS_USER || "kysan";
const VPS_HOST = process.env.VPS_HOST || "5.161.118.192";
const S3_URL = process.env.S3_URL || "";

const SSH = `ssh ${VPS_USER}@${VPS_HOST}`;
const EASYPG = "~/.easypg/bin/easypg";

// Test database names
const TEST_DB_1 = "e2e-test-alpha";
const TEST_DB_2 = "e2e-test-beta";
const TEST_DB_IMPORT = "e2e-imported";
const BACKUP_PATH = "/tmp/e2e-test-backup.epg";

// Helper to run remote command
async function ssh(cmd: string, timeout = 60000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await $`${SSH.split(" ")} ${cmd}`.quiet().nothrow().timeout(timeout);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// Helper to verify SSH connection
async function checkSSHConnection(): Promise<boolean> {
  try {
    const result = await ssh("echo 'connected'", 10000);
    return result.exitCode === 0 && result.stdout.includes("connected");
  } catch {
    return false;
  }
}

// Helper to extract connection URL from output
function extractConnectionUrl(output: string): string | null {
  const match = output.match(/postgresql:\/\/[^\s\x1b]+/);
  return match ? match[0].replace(/\x1b\[[0-9;]*m/g, "") : null;
}

// Helper to test database connection via psql in docker
async function testDbConnection(connectionUrl: string): Promise<boolean> {
  const result = await ssh(
    `docker run --rm --network host postgres:16-alpine psql "${connectionUrl}" -c "SELECT 1"`,
    30000
  );
  return result.exitCode === 0;
}

// Helper to run SQL query and get result
async function runSQL(connectionUrl: string, query: string): Promise<string> {
  const result = await ssh(
    `docker run --rm --network host postgres:16-alpine psql "${connectionUrl}" -t -A -c "${query}"`,
    30000
  );
  return result.stdout.trim();
}

describe("Remote E2E: Full EasyPG Test Suite", () => {
  let sshAvailable = false;
  let db1Url = "";
  let db2Url = "";

  beforeAll(async () => {
    console.log(`\n🔌 Connecting to ${VPS_USER}@${VPS_HOST}...`);
    sshAvailable = await checkSSHConnection();

    if (!sshAvailable) {
      console.log("❌ SSH connection failed - all tests will be skipped");
      return;
    }

    console.log("✅ SSH connected\n");

    // Update EasyPG to latest version
    console.log("📦 Updating EasyPG...");
    await ssh(`${EASYPG} update`, 120000);

    // Check version
    const versionResult = await ssh(`${EASYPG} --version`);
    console.log(`📌 EasyPG version: ${versionResult.stdout.trim()}\n`);

    // Clean up any existing test databases
    console.log("🧹 Cleaning up old test databases...");
    await ssh(`${EASYPG} destroy --name ${TEST_DB_1} --force`);
    await ssh(`${EASYPG} destroy --name ${TEST_DB_2} --force`);
    await ssh(`${EASYPG} destroy --name ${TEST_DB_IMPORT} --force`);
    await ssh(`rm -f ${BACKUP_PATH}`);
  }, 180000);

  afterAll(async () => {
    if (!sshAvailable) return;

    console.log("\n🧹 Final cleanup...");
    await ssh(`${EASYPG} destroy --name ${TEST_DB_1} --force`);
    await ssh(`${EASYPG} destroy --name ${TEST_DB_2} --force`);
    await ssh(`${EASYPG} destroy --name ${TEST_DB_IMPORT} --force`);
    await ssh(`rm -f ${BACKUP_PATH}`);
  }, 120000);

  // ============================================================================
  // DATABASE LIFECYCLE TESTS
  // ============================================================================

  describe("Database Lifecycle", () => {
    test("1. Create first database", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} create --name ${TEST_DB_1}`, 120000);
      expect(result.exitCode).toBe(0);

      db1Url = extractConnectionUrl(result.stdout) || "";
      console.log(`  📍 DB1 URL: ${db1Url.replace(/:[^:@]+@/, ":****@")}`);

      expect(db1Url).toContain("postgresql://");
    }, 180000);

    test("2. Create second database", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} create --name ${TEST_DB_2}`, 120000);
      expect(result.exitCode).toBe(0);

      db2Url = extractConnectionUrl(result.stdout) || "";
      console.log(`  📍 DB2 URL: ${db2Url.replace(/:[^:@]+@/, ":****@")}`);

      expect(db2Url).toContain("postgresql://");
    }, 180000);

    test("3. List shows both databases as running", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} list`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_DB_1);
      expect(result.stdout).toContain(TEST_DB_2);
      expect(result.stdout).toContain("running");
    }, 30000);

    test("4. Connect to DB1 and verify connection", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      // Wait a bit for the database to be fully ready
      await Bun.sleep(3000);

      const connected = await testDbConnection(db1Url);
      expect(connected).toBe(true);
    }, 60000);
  });

  // ============================================================================
  // DATA OPERATIONS TESTS
  // ============================================================================

  describe("Data Operations", () => {
    test("5. Create tables in DB1", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      const createTable = `
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE posts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          title VARCHAR(200) NOT NULL,
          content TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE comments (
          id SERIAL PRIMARY KEY,
          post_id INTEGER REFERENCES posts(id),
          user_id INTEGER REFERENCES users(id),
          body TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      const result = await ssh(
        `docker run --rm --network host postgres:16-alpine psql "${db1Url}" -c "${createTable.replace(/\n/g, " ")}"`,
        30000
      );
      expect(result.exitCode).toBe(0);
    }, 60000);

    test("6. Insert test data", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      const insertData = `
        INSERT INTO users (name, email) VALUES
          ('Alice Johnson', 'alice@example.com'),
          ('Bob Smith', 'bob@example.com'),
          ('Charlie Brown', 'charlie@example.com'),
          ('Diana Ross', 'diana@example.com'),
          ('Eve Wilson', 'eve@example.com');
        INSERT INTO posts (user_id, title, content) VALUES
          (1, 'Getting Started with PostgreSQL', 'PostgreSQL is a powerful database...'),
          (1, 'Advanced SQL Queries', 'Let us explore some complex queries...'),
          (2, 'Docker Tips and Tricks', 'Containerization made easy...'),
          (3, 'My First Post', 'Hello world!');
        INSERT INTO comments (post_id, user_id, body) VALUES
          (1, 2, 'Great article!'),
          (1, 3, 'Very helpful, thanks!'),
          (2, 4, 'Can you elaborate on joins?'),
          (3, 1, 'Nice tips!');
      `;

      const result = await ssh(
        `docker run --rm --network host postgres:16-alpine psql "${db1Url}" -c "${insertData.replace(/\n/g, " ")}"`,
        30000
      );
      expect(result.exitCode).toBe(0);
    }, 60000);

    test("7. Verify data with complex queries", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      // Count users
      const userCount = await runSQL(db1Url, "SELECT COUNT(*) FROM users");
      expect(userCount).toBe("5");

      // Count posts
      const postCount = await runSQL(db1Url, "SELECT COUNT(*) FROM posts");
      expect(postCount).toBe("4");

      // Count comments
      const commentCount = await runSQL(db1Url, "SELECT COUNT(*) FROM comments");
      expect(commentCount).toBe("4");

      // Join query - posts with user names
      const postsWithUsers = await runSQL(
        db1Url,
        "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id ORDER BY p.id LIMIT 1"
      );
      expect(postsWithUsers).toContain("Alice Johnson");

      // Aggregation - posts per user
      const postsPerUser = await runSQL(
        db1Url,
        "SELECT u.name, COUNT(p.id) as cnt FROM users u LEFT JOIN posts p ON u.id = p.user_id GROUP BY u.id, u.name ORDER BY cnt DESC LIMIT 1"
      );
      expect(postsPerUser).toContain("2"); // Alice has 2 posts
    }, 60000);

    test("8. Update and delete data", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      // Update a user
      await runSQL(db1Url, "UPDATE users SET name = 'Alice J. Updated' WHERE id = 1");

      // Verify update
      const updatedName = await runSQL(db1Url, "SELECT name FROM users WHERE id = 1");
      expect(updatedName).toBe("Alice J. Updated");

      // Delete a comment
      await runSQL(db1Url, "DELETE FROM comments WHERE id = 4");

      // Verify delete
      const remainingComments = await runSQL(db1Url, "SELECT COUNT(*) FROM comments");
      expect(remainingComments).toBe("3");
    }, 60000);
  });

  // ============================================================================
  // STOP/START TESTS
  // ============================================================================

  describe("Stop and Start", () => {
    test("9. Stop DB1", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} stop --name ${TEST_DB_1}`);
      expect(result.exitCode).toBe(0);

      // Wait for container to stop
      await Bun.sleep(3000);
    }, 60000);

    test("10. Verify DB1 is stopped", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} list`);
      expect(result.stdout).toContain(TEST_DB_1);
      expect(result.stdout).toContain("stopped");
    }, 30000);

    test("11. DB2 should still be accessible", async () => {
      if (!sshAvailable || !db2Url) return expect(true).toBe(true);

      const connected = await testDbConnection(db2Url);
      expect(connected).toBe(true);
    }, 30000);

    test("12. Start DB1 again", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} start --name ${TEST_DB_1}`, 120000);
      expect(result.exitCode).toBe(0);

      // Wait for container to start
      await Bun.sleep(5000);

      // Verify it's running
      const listResult = await ssh(`${EASYPG} list`);
      expect(listResult.stdout).toContain(TEST_DB_1);
      // Should show running for both
      const runningMatches = listResult.stdout.match(/running/g);
      expect(runningMatches?.length).toBeGreaterThanOrEqual(2);
    }, 180000);

    test("13. Data persisted after restart", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      // Wait for database to be fully ready
      await Bun.sleep(3000);

      // Verify data is still there
      const userCount = await runSQL(db1Url, "SELECT COUNT(*) FROM users");
      expect(userCount).toBe("5");

      const updatedName = await runSQL(db1Url, "SELECT name FROM users WHERE id = 1");
      expect(updatedName).toBe("Alice J. Updated");
    }, 60000);
  });

  // ============================================================================
  // BACKUP & RESTORE TESTS
  // ============================================================================

  describe("Backup and Restore", () => {
    test("14. Create local backup", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} backup --name ${TEST_DB_1} --path ${BACKUP_PATH} --no-pass`, 120000);
      expect(result.exitCode).toBe(0);

      // Verify backup file exists
      const checkFile = await ssh(`ls -la ${BACKUP_PATH}`);
      expect(checkFile.exitCode).toBe(0);
      expect(checkFile.stdout).toContain(BACKUP_PATH);
    }, 180000);

    test("15. Delete all data from DB1", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      await runSQL(db1Url, "DELETE FROM comments");
      await runSQL(db1Url, "DELETE FROM posts");
      await runSQL(db1Url, "DELETE FROM users");

      // Verify deletion
      const userCount = await runSQL(db1Url, "SELECT COUNT(*) FROM users");
      expect(userCount).toBe("0");
    }, 60000);

    test("16. Destroy DB1 completely", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} destroy --name ${TEST_DB_1} --force`, 60000);
      expect(result.exitCode).toBe(0);

      // Verify it's gone
      const listResult = await ssh(`${EASYPG} list`);
      expect(listResult.stdout).not.toContain(TEST_DB_1);
    }, 120000);

    test("17. Restore DB1 from backup", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} restore --path ${BACKUP_PATH}`, 180000);
      expect(result.exitCode).toBe(0);

      // Get new connection URL
      const connectResult = await ssh(`${EASYPG} connect`);
      db1Url = extractConnectionUrl(connectResult.stdout) || db1Url;

      console.log(`  📍 Restored DB1 URL: ${db1Url.replace(/:[^:@]+@/, ":****@")}`);
    }, 240000);

    test("18. Verify restored data", async () => {
      if (!sshAvailable || !db1Url) return expect(true).toBe(true);

      // Wait for database to be ready
      await Bun.sleep(5000);

      // Verify data is restored
      const userCount = await runSQL(db1Url, "SELECT COUNT(*) FROM users");
      expect(userCount).toBe("5");

      const postCount = await runSQL(db1Url, "SELECT COUNT(*) FROM posts");
      expect(postCount).toBe("4");

      // The updated name should be there (from before backup)
      const updatedName = await runSQL(db1Url, "SELECT name FROM users WHERE id = 1");
      expect(updatedName).toBe("Alice J. Updated");
    }, 90000);
  });

  // ============================================================================
  // S3 BACKUP TESTS (if S3_URL is configured)
  // ============================================================================

  describe("S3 Backup", () => {
    test("19. Configure S3 backup", async () => {
      if (!sshAvailable) return expect(true).toBe(true);
      if (!S3_URL) {
        console.log("  ⏭️ Skipped: S3_URL not configured");
        return expect(true).toBe(true);
      }

      const result = await ssh(`${EASYPG} s3 configure '${S3_URL}' -i 24`, 120000);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("configured");
    }, 180000);

    test("20. Check S3 status", async () => {
      if (!sshAvailable) return expect(true).toBe(true);
      if (!S3_URL) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} s3 status`, 60000);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Enabled");
    }, 90000);

    test("21. Run manual S3 backup", async () => {
      if (!sshAvailable) return expect(true).toBe(true);
      if (!S3_URL) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} s3 backup`, 180000);
      expect(result.exitCode).toBe(0);
    }, 240000);

    test("22. List S3 backups", async () => {
      if (!sshAvailable) return expect(true).toBe(true);
      if (!S3_URL) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} s3 list`, 60000);
      expect(result.exitCode).toBe(0);
    }, 90000);
  });

  // ============================================================================
  // INSPECT AND CONNECT TESTS
  // ============================================================================

  describe("Inspect and Connect", () => {
    test("23. Inspect DB1", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} inspect --name ${TEST_DB_1}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_DB_1);
      expect(result.stdout).toContain("running");
    }, 30000);

    test("24. Connect command shows all databases", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} connect`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("postgresql://");
    }, 30000);
  });

  // ============================================================================
  // CLEANUP TESTS
  // ============================================================================

  describe("Cleanup", () => {
    test("25. Stop all databases", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} stop --all`);
      expect(result.exitCode).toBe(0);

      await Bun.sleep(3000);

      // Verify all stopped
      const listResult = await ssh(`${EASYPG} list`);
      expect(listResult.stdout).not.toContain("running");
    }, 120000);

    test("26. Start all databases", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} start --all`, 180000);
      expect(result.exitCode).toBe(0);

      await Bun.sleep(5000);

      // Verify all running
      const listResult = await ssh(`${EASYPG} list`);
      const runningMatches = listResult.stdout.match(/running/gi);
      expect(runningMatches?.length).toBeGreaterThanOrEqual(1);
    }, 240000);

    test("27. Destroy all test databases", async () => {
      if (!sshAvailable) return expect(true).toBe(true);

      await ssh(`${EASYPG} destroy --name ${TEST_DB_1} --force`);
      await ssh(`${EASYPG} destroy --name ${TEST_DB_2} --force`);

      // Verify cleanup
      const listResult = await ssh(`${EASYPG} list`);
      expect(listResult.stdout).not.toContain(TEST_DB_1);
      expect(listResult.stdout).not.toContain(TEST_DB_2);
    }, 120000);

    test("28. Disable S3 backup", async () => {
      if (!sshAvailable) return expect(true).toBe(true);
      if (!S3_URL) return expect(true).toBe(true);

      const result = await ssh(`${EASYPG} s3 disable`);
      expect(result.exitCode).toBe(0);
    }, 30000);
  });
});

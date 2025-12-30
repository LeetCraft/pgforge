import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";

const TEST_DB_NAME = "e2e-test-db";
const CLI = "bun run src/cli.ts";

// Helper to check if Docker is responsive
async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await Promise.race([
      $`docker version --format '{{.Server.Version}}'`.quiet().nothrow(),
      new Promise<{ exitCode: number }>((resolve) =>
        setTimeout(() => resolve({ exitCode: 1 }), 5000)
      ),
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Helper to wait for database to be ready
async function waitForDatabase(connectionUrl: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const sql = new (await import("postgres")).default(connectionUrl);
      await sql`SELECT 1`;
      await sql.end();
      return true;
    } catch {
      await Bun.sleep(1000);
    }
  }
  return false;
}

// Helper to extract connection URL from CLI output
function extractConnectionUrl(output: string): string | null {
  const match = output.match(/postgresql:\/\/[^\s]+/);
  return match ? match[0] : null;
}

describe("E2E: Full database lifecycle", () => {
  let connectionUrl: string;
  let dockerAvailable: boolean;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Docker not available - E2E tests will be skipped");
      return;
    }

    // Ensure EasyPG is set up
    await $`${CLI} setup`.quiet().nothrow();

    // Clean up any existing test database
    await $`${CLI} destroy --name ${TEST_DB_NAME} --force`.quiet().nothrow();
  });

  afterAll(async () => {
    if (!dockerAvailable) return;

    // Clean up test database
    await $`${CLI} destroy --name ${TEST_DB_NAME} --force`.quiet().nothrow();
  });

  test("1. Create database", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} create --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    const output = result.stdout.toString();
    connectionUrl = extractConnectionUrl(output) || "";
    expect(connectionUrl).toContain("postgresql://");
    expect(connectionUrl).toContain(TEST_DB_NAME.replace(/-/g, "_"));
  }, 120000); // 2 minute timeout for container creation

  test("2. Connect and create table", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    // Wait for database to be ready
    const ready = await waitForDatabase(connectionUrl);
    expect(ready).toBe(true);

    // Connect and create table
    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Verify table exists
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    `;
    expect(tables.length).toBe(1);

    await sql.end();
  }, 60000);

  test("3. Insert test data", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    // Insert test users
    await sql`INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')`;
    await sql`INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')`;
    await sql`INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@example.com')`;

    // Verify data
    const users = await sql`SELECT * FROM users ORDER BY id`;
    expect(users.length).toBe(3);
    expect(users[0].name).toBe("Alice");
    expect(users[1].name).toBe("Bob");
    expect(users[2].name).toBe("Charlie");

    await sql.end();
  }, 30000);

  test("4. Query and update data", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    // Update a user
    await sql`UPDATE users SET name = 'Alice Smith' WHERE email = 'alice@example.com'`;

    // Query updated data
    const alice = await sql`SELECT * FROM users WHERE email = 'alice@example.com'`;
    expect(alice.length).toBe(1);
    expect(alice[0].name).toBe("Alice Smith");

    // Count users
    const count = await sql`SELECT COUNT(*) as count FROM users`;
    expect(Number(count[0].count)).toBe(3);

    await sql.end();
  }, 30000);

  test("5. Create backup", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} backup --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    const output = result.stdout.toString();
    expect(output).toContain("backup");
  }, 60000);

  test("6. Stop database", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} stop --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    // Wait a bit for container to stop
    await Bun.sleep(3000);

    // Verify database is stopped (connection should fail)
    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl, { connect_timeout: 5 });

    let connectionFailed = false;
    try {
      await sql`SELECT 1`;
    } catch (err) {
      connectionFailed = true;
    }

    expect(connectionFailed).toBe(true);
    await sql.end();
  }, 60000);

  test("7. Verify database is listed as stopped", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} list`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    const output = result.stdout.toString();
    expect(output).toContain(TEST_DB_NAME);
    expect(output).toContain("stopped");
  }, 30000);

  test("8. Start database", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} start --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    // Wait for database to be ready
    const ready = await waitForDatabase(connectionUrl);
    expect(ready).toBe(true);
  }, 120000);

  test("9. Verify data persisted after restart", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    // Check all data is still there
    const users = await sql`SELECT * FROM users ORDER BY id`;
    expect(users.length).toBe(3);
    expect(users[0].name).toBe("Alice Smith"); // Updated name should persist
    expect(users[1].name).toBe("Bob");
    expect(users[2].name).toBe("Charlie");

    await sql.end();
  }, 30000);

  test("10. Delete data and restore from backup", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    // Delete all data
    await sql`DELETE FROM users`;
    const afterDelete = await sql`SELECT COUNT(*) as count FROM users`;
    expect(Number(afterDelete[0].count)).toBe(0);

    await sql.end();

    // Restore from backup
    const result = await $`${CLI} restore --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    // Wait a moment for restore
    await Bun.sleep(2000);

    // Verify data is restored
    const sql2 = postgres(connectionUrl);
    const afterRestore = await sql2`SELECT * FROM users ORDER BY id`;
    expect(afterRestore.length).toBe(3);
    expect(afterRestore[0].name).toBe("Alice Smith");

    await sql2.end();
  }, 120000);

  test("11. Inspect database", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} inspect --name ${TEST_DB_NAME}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    const output = result.stdout.toString();
    expect(output).toContain(TEST_DB_NAME);
    expect(output).toContain("running");
  }, 30000);

  test("12. Connect command shows URL", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} connect`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    const output = result.stdout.toString();
    expect(output).toContain("postgresql://");
    expect(output).toContain(TEST_DB_NAME.replace(/-/g, "_"));
  }, 30000);

  test("13. Complex queries work", async () => {
    if (!dockerAvailable || !connectionUrl) {
      console.log("Skipping: Docker not available or no connection URL");
      expect(true).toBe(true);
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(connectionUrl);

    // Create additional table
    await sql`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title VARCHAR(200) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Insert posts
    await sql`INSERT INTO posts (user_id, title, content) VALUES (1, 'Hello World', 'This is my first post')`;
    await sql`INSERT INTO posts (user_id, title, content) VALUES (1, 'Second Post', 'More content here')`;
    await sql`INSERT INTO posts (user_id, title, content) VALUES (2, 'Bob''s Post', 'Bob writes too')`;

    // Complex join query
    const postsWithUsers = await sql`
      SELECT u.name, p.title, p.content
      FROM users u
      JOIN posts p ON u.id = p.user_id
      ORDER BY p.id
    `;

    expect(postsWithUsers.length).toBe(3);
    expect(postsWithUsers[0].name).toBe("Alice Smith");
    expect(postsWithUsers[0].title).toBe("Hello World");

    // Aggregation query
    const postCounts = await sql`
      SELECT u.name, COUNT(p.id) as post_count
      FROM users u
      LEFT JOIN posts p ON u.id = p.user_id
      GROUP BY u.id, u.name
      ORDER BY post_count DESC
    `;

    expect(postCounts.length).toBe(3);
    expect(Number(postCounts[0].post_count)).toBe(2); // Alice has 2 posts

    await sql.end();
  }, 60000);

  test("14. Destroy database", async () => {
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const result = await $`${CLI} destroy --name ${TEST_DB_NAME} --force`.quiet().nothrow();
    expect(result.exitCode).toBe(0);

    // Verify database is gone from list
    const listResult = await $`${CLI} list`.quiet().nothrow();
    const output = listResult.stdout.toString();
    expect(output).not.toContain(TEST_DB_NAME);
  }, 60000);
});

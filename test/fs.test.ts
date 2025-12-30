import { test, expect, beforeEach } from "bun:test";
import { join } from "path";
import { PATHS } from "../src/lib/constants";
import {
  ensureDirectories,
  ensureDatabaseDir,
  getDatabasePath,
  getComposePath,
  databaseExists,
  getState,
  saveState,
  getAllDatabases,
} from "../src/lib/fs";

beforeEach(async () => {
  await ensureDirectories();
});

test("getDatabasePath returns correct path", () => {
  const path = getDatabasePath("mydb");
  expect(path).toBe(`${PATHS.databases}/mydb`);
});

test("getComposePath returns correct docker-compose path", () => {
  const path = getComposePath("mydb");
  expect(path).toBe(`${PATHS.databases}/mydb/docker-compose.yml`);
});

test("ensureDatabaseDir creates database directories", async () => {
  const dbPath = await ensureDatabaseDir("test-ensure-db");

  expect(dbPath).toContain("test-ensure-db");

  // Check subdirectories exist
  const dataExists = (await Bun.$`test -d ${dbPath}/data`.quiet().nothrow()).exitCode === 0;
  const backupsExists = (await Bun.$`test -d ${dbPath}/backups`.quiet().nothrow()).exitCode === 0;

  expect(dataExists).toBe(true);
  expect(backupsExists).toBe(true);

  // Cleanup
  await Bun.$`rm -rf ${dbPath}`.quiet().nothrow();
});

test("databaseExists returns false for non-existent database", async () => {
  const exists = await databaseExists("non-existent-db-12345");
  expect(exists).toBe(false);
});

test("getState returns default state when empty", async () => {
  const state = await getState();

  expect(state).toHaveProperty("databases");
  expect(state).toHaveProperty("lastUpdated");
  expect(typeof state.databases).toBe("object");
});

test("saveState persists and updates lastUpdated", async () => {
  const testState = {
    databases: {
      "test-db": {
        name: "test-db",
        port: 54320,
        username: "user",
        password: "pass",
        database: "testdb",
        status: "running" as const,
        createdAt: new Date().toISOString(),
        pgVersion: "16-alpine",
        poolerEnabled: true,
      },
    },
    lastUpdated: "old-date",
  };

  await saveState(testState);
  const loaded = await getState();

  expect(loaded.databases["test-db"]).toBeDefined();
  expect(loaded.databases["test-db"].name).toBe("test-db");
  expect(loaded.lastUpdated).not.toBe("old-date"); // Should be updated
});

test("getAllDatabases returns array of databases", async () => {
  const testState = {
    databases: {
      "db1": {
        name: "db1",
        port: 54320,
        username: "user1",
        password: "pass1",
        database: "db1",
        status: "running" as const,
        createdAt: new Date().toISOString(),
        pgVersion: "16-alpine",
        poolerEnabled: true,
      },
      "db2": {
        name: "db2",
        port: 54321,
        username: "user2",
        password: "pass2",
        database: "db2",
        status: "stopped" as const,
        createdAt: new Date().toISOString(),
        pgVersion: "16-alpine",
        poolerEnabled: true,
      },
    },
    lastUpdated: new Date().toISOString(),
  };

  await saveState(testState);
  const databases = await getAllDatabases();

  expect(Array.isArray(databases)).toBe(true);
  expect(databases.length).toBe(2);
  expect(databases.some(db => db.name === "db1")).toBe(true);
  expect(databases.some(db => db.name === "db2")).toBe(true);
});

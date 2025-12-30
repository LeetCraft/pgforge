import { test, expect, describe } from "bun:test";
import type { Config, DatabaseState, State, PortRegistry, BackupMetadata } from "../src/lib/types";

describe("Type definitions", () => {
  test("Config type has correct structure", () => {
    const config: Config = {
      initialized: true,
      publicIp: "192.168.1.1",
      createdAt: new Date().toISOString(),
      version: "1.0.0",
    };

    expect(config.initialized).toBe(true);
    expect(config.publicIp).toBe("192.168.1.1");
    expect(typeof config.createdAt).toBe("string");
    expect(config.version).toBe("1.0.0");
  });

  test("DatabaseState type has correct structure", () => {
    const dbState: DatabaseState = {
      name: "testdb",
      port: 54320,
      username: "user",
      password: "pass",
      database: "testdb",
      status: "running",
      createdAt: new Date().toISOString(),
      pgVersion: "16-alpine",
      poolerEnabled: true,
    };

    expect(dbState.name).toBe("testdb");
    expect(dbState.port).toBe(54320);
    expect(dbState.status).toBe("running");
    expect(dbState.poolerEnabled).toBe(true);
  });

  test("DatabaseState supports all valid statuses", () => {
    const statuses: DatabaseState["status"][] = ["running", "stopped", "creating", "error"];

    statuses.forEach(status => {
      const dbState: DatabaseState = {
        name: "testdb",
        port: 54320,
        username: "user",
        password: "pass",
        database: "testdb",
        status,
        createdAt: new Date().toISOString(),
        pgVersion: "16-alpine",
        poolerEnabled: true,
      };
      expect(dbState.status).toBe(status);
    });
  });

  test("State type has correct structure", () => {
    const state: State = {
      databases: {
        "db1": {
          name: "db1",
          port: 54320,
          username: "user",
          password: "pass",
          database: "db1",
          status: "running",
          createdAt: new Date().toISOString(),
          pgVersion: "16-alpine",
          poolerEnabled: true,
        },
      },
      lastUpdated: new Date().toISOString(),
    };

    expect(Object.keys(state.databases)).toHaveLength(1);
    expect(state.databases["db1"].name).toBe("db1");
    expect(typeof state.lastUpdated).toBe("string");
  });

  test("PortRegistry type has correct structure", () => {
    const registry: PortRegistry = {
      allocated: { "db1": 54320, "db2": 54321 },
      released: [54322],
      lastUpdated: new Date().toISOString(),
    };

    expect(registry.allocated["db1"]).toBe(54320);
    expect(registry.released).toContain(54322);
    expect(typeof registry.lastUpdated).toBe("string");
  });

  test("BackupMetadata type has correct structure", () => {
    const backup: BackupMetadata = {
      name: "testdb",
      database: "testdb",
      createdAt: new Date().toISOString(),
      size: 1024,
      path: "/path/to/backup.sql.gz",
    };

    expect(backup.name).toBe("testdb");
    expect(backup.size).toBe(1024);
    expect(backup.path).toContain(".sql.gz");
  });
});

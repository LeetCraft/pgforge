import { test, expect, describe, beforeAll } from "bun:test";
import { ensureDirectories, getConfig, saveConfig, getState, saveState } from "../src/lib/fs";
import { checkDocker } from "../src/lib/docker";
import { generateComposeFile } from "../src/lib/compose";
import { PATHS, PORT_RANGE } from "../src/lib/constants";

// Helper to check if Docker is responsive quickly
async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await Promise.race([
      Bun.$`docker version --format '{{.Server.Version}}'`.quiet().nothrow(),
      new Promise<{ exitCode: number }>((resolve) =>
        setTimeout(() => resolve({ exitCode: 1 }), 3000)
      ),
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

describe("Integration tests", () => {
  beforeAll(async () => {
    await ensureDirectories();
  });

  test("full config lifecycle", async () => {
    // Save config
    const config = {
      initialized: true,
      publicIp: "10.0.0.1",
      createdAt: new Date().toISOString(),
      version: "1.0.0",
    };
    await saveConfig(config);

    // Read config
    const loaded = await getConfig();
    expect(loaded.initialized).toBe(true);
    expect(loaded.publicIp).toBe("10.0.0.1");
  });

  test("full state lifecycle", async () => {
    // Create initial state
    const initialState = {
      databases: {},
      lastUpdated: new Date().toISOString(),
    };
    await saveState(initialState);

    // Add a database
    const state = await getState();
    state.databases["integration-test-db"] = {
      name: "integration-test-db",
      port: 54350,
      username: "int_user",
      password: "int_pass",
      database: "integration_db",
      status: "running",
      createdAt: new Date().toISOString(),
      pgVersion: "16-alpine",
      poolerEnabled: true,
    };
    await saveState(state);

    // Verify database was saved
    const loadedState = await getState();
    expect(loadedState.databases["integration-test-db"]).toBeDefined();
    expect(loadedState.databases["integration-test-db"].port).toBe(54350);

    // Cleanup
    delete loadedState.databases["integration-test-db"];
    await saveState(loadedState);
  });

  test("docker compose generation produces valid YAML", () => {
    const compose = generateComposeFile({
      name: "integration-db",
      port: 54360,
      username: "int_user",
      password: "int_pass123",
      database: "int_db",
      enablePooler: true,
    });

    // Verify YAML structure (basic checks)
    expect(compose).toContain("services:");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("pgbouncer:");
    expect(compose).toContain("networks:");

    // Verify no YAML syntax errors (no tabs, proper indentation)
    expect(compose).not.toContain("\t"); // No tabs
    const lines = compose.split("\n");
    for (const line of lines) {
      if (line.trim().length > 0) {
        // Each non-empty line should have proper indentation (multiples of 2)
        const indent = line.match(/^(\s*)/)?.[1].length || 0;
        expect(indent % 2).toBe(0);
      }
    }
  });

  test("port range has enough capacity", () => {
    const capacity = PORT_RANGE.end - PORT_RANGE.start + 1;
    expect(capacity).toBeGreaterThanOrEqual(80); // At least 80 databases
  });

  test("docker check returns consistent results", async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const check1 = await checkDocker();
    const check2 = await checkDocker();

    expect(check1.installed).toBe(check2.installed);
    expect(check1.running).toBe(check2.running);
    expect(check1.compose).toBe(check2.compose);
  }, 10000);
});

import { test, expect, beforeAll, afterAll } from "bun:test";
import { PATHS, FILES } from "../src/lib/constants";
import { ensureDirectories, getConfig, saveConfig } from "../src/lib/fs";
import { checkDocker } from "../src/lib/docker";

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

test("ensureDirectories creates all required directories", async () => {
  await ensureDirectories();

  for (const path of Object.values(PATHS)) {
    const exists = await Bun.file(path).exists() ||
      (await Bun.$`test -d ${path}`.quiet().nothrow()).exitCode === 0;
    expect(exists).toBe(true);
  }
});

test("checkDocker detects Docker installation", async () => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    console.log("Skipping: Docker not available");
    expect(true).toBe(true);
    return;
  }

  const result = await checkDocker();

  expect(result).toHaveProperty("installed");
  expect(result).toHaveProperty("running");
  expect(result).toHaveProperty("compose");
  expect(typeof result.installed).toBe("boolean");
  expect(typeof result.running).toBe("boolean");
  expect(typeof result.compose).toBe("boolean");
}, 10000);

test("getConfig returns default config when not initialized", async () => {
  const config = await getConfig();

  expect(config).toHaveProperty("initialized");
  expect(config).toHaveProperty("publicIp");
  expect(config).toHaveProperty("createdAt");
  expect(config).toHaveProperty("version");
});

test("saveConfig persists config correctly", async () => {
  await ensureDirectories();

  const testConfig = {
    initialized: true,
    publicIp: "192.168.1.1",
    createdAt: new Date().toISOString(),
    version: "1.0.0",
  };

  await saveConfig(testConfig);
  const loaded = await getConfig();

  expect(loaded.initialized).toBe(true);
  expect(loaded.publicIp).toBe("192.168.1.1");
  expect(loaded.version).toBe("1.0.0");
});

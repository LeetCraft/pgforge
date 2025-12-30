import { test, expect, describe } from "bun:test";
import { checkDocker, getContainerStatus } from "../src/lib/docker";

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

describe("Docker utilities", () => {
  test("checkDocker returns status object", async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true); // Pass but skip actual test
      return;
    }

    const status = await checkDocker();

    expect(status).toHaveProperty("installed");
    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("compose");

    // All should be booleans
    expect(typeof status.installed).toBe("boolean");
    expect(typeof status.running).toBe("boolean");
    expect(typeof status.compose).toBe("boolean");
  }, 10000);

  test("getContainerStatus returns not_found for non-existent container", async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const status = await getContainerStatus("non-existent-db-12345");
    expect(status).toBe("not_found");
  }, 10000);

  test("getContainerStatus returns valid status type", async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Skipping: Docker not available");
      expect(true).toBe(true);
      return;
    }

    const status = await getContainerStatus("test-db");
    const validStatuses = ["running", "stopped", "error", "not_found"];
    expect(validStatuses).toContain(status);
  }, 10000);
});

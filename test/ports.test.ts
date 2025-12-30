import { test, expect, beforeEach } from "bun:test";
import { PORT_RANGE } from "../src/lib/constants";
import { getPortRegistry, savePortRegistry } from "../src/lib/fs";
import { ensureDirectories } from "../src/lib/fs";

beforeEach(async () => {
  await ensureDirectories();
});

test("PORT_RANGE has valid start and end", () => {
  expect(PORT_RANGE.start).toBe(75001);
  expect(PORT_RANGE.end).toBe(75999);
  expect(PORT_RANGE.end).toBeGreaterThan(PORT_RANGE.start);
});

test("getPortRegistry returns default empty registry", async () => {
  const registry = await getPortRegistry();

  expect(registry).toHaveProperty("allocated");
  expect(registry).toHaveProperty("released");
  expect(registry).toHaveProperty("lastUpdated");
  expect(typeof registry.allocated).toBe("object");
  expect(Array.isArray(registry.released)).toBe(true);
});

test("savePortRegistry persists allocations", async () => {
  const testRegistry = {
    version: 1,
    allocated: { "test-db": 75001 },
    released: [],
    lastUpdated: new Date().toISOString(),
  };

  await savePortRegistry(testRegistry);
  const loaded = await getPortRegistry();

  expect(loaded.allocated["test-db"]).toBe(75001);
});

test("port allocation is within valid range", async () => {
  const registry = await getPortRegistry();

  for (const port of Object.values(registry.allocated)) {
    expect(port).toBeGreaterThanOrEqual(PORT_RANGE.start);
    expect(port).toBeLessThanOrEqual(PORT_RANGE.end);
  }
});

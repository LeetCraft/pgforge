import { PORT_RANGE } from "./constants";
import { getPortRegistry, savePortRegistry } from "./fs";

/**
 * Allocate a port for a database
 * - If the database already has a port allocated, return it (and verify it's free)
 * - Otherwise, find the next available port in the range
 * - Ports are never reused by different databases
 * - Always verifies the port is actually free on the system before allocating
 */
export async function allocatePort(dbName: string): Promise<number> {
  const registry = await getPortRegistry();

  // If this database already has a port, verify it's free and return it
  if (registry.allocated[dbName] !== undefined) {
    const existingPort = registry.allocated[dbName];
    // Verify the port is actually available on the system
    if (await isPortAvailable(existingPort)) {
      return existingPort;
    }
    // Port is in use by something else - we need to find a new one
    // Remove the old allocation first
    delete registry.allocated[dbName];
  }

  // Find all used ports in registry
  const usedPorts = new Set(Object.values(registry.allocated));

  // Find next available port that is BOTH not in registry AND actually free on system
  for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
    if (!usedPorts.has(port) && await isPortAvailable(port)) {
      registry.allocated[dbName] = port;
      await savePortRegistry(registry);
      return port;
    }
  }

  throw new Error(
    `No available ports in range ${PORT_RANGE.start}-${PORT_RANGE.end}. ` +
    `Maximum ${PORT_RANGE.end - PORT_RANGE.start + 1} databases supported.`
  );
}

/**
 * Get the port for a database (if allocated)
 */
export async function getPort(dbName: string): Promise<number | null> {
  const registry = await getPortRegistry();
  return registry.allocated[dbName] ?? null;
}

/**
 * Release a port when a database is deleted or creation fails
 * Removes the port allocation so it can be reused
 */
export async function releasePort(dbName: string): Promise<void> {
  const registry = await getPortRegistry();
  if (registry.allocated[dbName] !== undefined) {
    delete registry.allocated[dbName];
    await savePortRegistry(registry);
  }
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const result = await Bun.$`lsof -i :${port}`.quiet().nothrow();
    return result.exitCode !== 0;
  } catch {
    return true;
  }
}

/**
 * Get port allocation summary
 */
export async function getPortSummary(): Promise<{
  total: number;
  used: number;
  available: number;
}> {
  const registry = await getPortRegistry();
  const total = PORT_RANGE.end - PORT_RANGE.start + 1;
  const used = Object.keys(registry.allocated).length;

  return {
    total,
    used,
    available: total - used,
  };
}

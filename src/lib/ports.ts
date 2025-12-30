import { PORT_RANGE } from "./constants";
import { getPortRegistry, savePortRegistry } from "./fs";

/**
 * Allocate a port for a database
 * - If the database already has a port allocated, return it
 * - Otherwise, find the next available port in the range
 * - Ports are never reused by different databases
 */
export async function allocatePort(dbName: string): Promise<number> {
  const registry = await getPortRegistry();

  // If this database already has a port, return it
  if (registry.allocated[dbName] !== undefined) {
    return registry.allocated[dbName];
  }

  // Find all used ports
  const usedPorts = new Set(Object.values(registry.allocated));

  // Find next available port
  for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
    if (!usedPorts.has(port)) {
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
 * Release a port when a database is deleted
 * The port remains reserved for this database name forever
 * This ensures if the user recreates a DB with the same name, it gets the same port
 */
export async function releasePort(dbName: string): Promise<void> {
  const registry = await getPortRegistry();
  // We intentionally keep the port allocated to this name
  // This prevents port reuse issues in serverless environments
  // where connection strings might be cached
  await savePortRegistry(registry);
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

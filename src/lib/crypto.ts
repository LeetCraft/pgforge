import { nanoid } from "nanoid";

/**
 * Generate a secure random password
 */
export function generatePassword(length: number = 32): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => charset[b % charset.length])
    .join("");
}

/**
 * Generate a database username
 * Format: db_{short_id}
 */
export function generateUsername(): string {
  return `db_${nanoid(8).toLowerCase()}`;
}

/**
 * Generate a database name
 * Format: easy_{short_id}
 */
export function generateDatabaseName(): string {
  return `easy_${nanoid(6).toLowerCase()}`;
}

/**
 * Sanitize a database name
 * Only allow alphanumeric characters, underscores, and hyphens
 */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^[^a-z]/, "db_$&")
    .slice(0, 63);
}

/**
 * Validate a database name
 */
export function isValidName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: "Name cannot be empty" };
  }

  if (name.length > 63) {
    return { valid: false, error: "Name cannot exceed 63 characters" };
  }

  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return {
      valid: false,
      error: "Name must start with a letter and contain only lowercase letters, numbers, underscores, and hyphens",
    };
  }

  const reserved = ["postgres", "template0", "template1", "admin", "root", "master"];
  if (reserved.includes(name)) {
    return { valid: false, error: `"${name}" is a reserved name` };
  }

  return { valid: true };
}

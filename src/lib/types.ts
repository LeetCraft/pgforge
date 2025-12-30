export interface Config {
  initialized: boolean;
  publicIp: string | null;
  createdAt: string;
  version: string;
}

export interface DatabaseState {
  name: string;
  port: number;
  username: string;
  password: string;
  database: string;
  status: "running" | "stopped" | "creating" | "error";
  createdAt: string;
  stoppedAt?: string;
  pgVersion: string;
  poolerEnabled: boolean;
  adminPassword?: string; // Internal admin password (not exposed to users)
}

export interface State {
  version: number; // State schema version for migrations
  databases: Record<string, DatabaseState>;
  lastUpdated: string;
}

export interface PortRegistry {
  version: number; // Schema version for migrations
  allocated: Record<string, number>; // dbName -> port
  released: number[]; // ports that were freed but reserved for their original db
  lastUpdated: string;
}

export interface BackupMetadata {
  name: string;
  database: string;
  createdAt: string;
  size: number;
  path: string;
}

// =============================================================================
// MIGRATION TYPES
// =============================================================================

export interface Migration {
  version: number;
  description: string;
  migrate: (data: unknown) => unknown;
}

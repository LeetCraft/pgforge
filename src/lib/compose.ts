import { POSTGRES_DEFAULTS, PGBOUNCER_DEFAULTS, INTERNAL_NETWORK } from "./constants";
import { getDatabasePath } from "./fs";

interface ComposeOptions {
  name: string;
  port: number;
  username: string;
  password: string;
  database: string;
  pgVersion?: string;
  enablePooler?: boolean;
  adminPassword?: string; // Internal admin password (for backups)
}

/**
 * Generate a production-ready docker-compose.yml for a database
 *
 * Architecture:
 * - PostgreSQL container on internal network only
 * - PgBouncer as connection pooler, exposed on public port
 * - All inter-container communication is internal
 * - Only PgBouncer port is exposed to the host
 */
export function generateComposeFile(options: ComposeOptions): string {
  const {
    name,
    port,
    username,
    password,
    database,
    pgVersion = POSTGRES_DEFAULTS.version,
    enablePooler = true,
    adminPassword = password, // Fallback for backward compatibility
  } = options;

  const dbPath = getDatabasePath(name);

  if (!enablePooler) {
    // Direct PostgreSQL connection (not recommended for serverless)
    return `# PgForge managed database: ${name}
# WARNING: Direct PostgreSQL connection - not optimized for serverless
version: "3.8"

services:
  postgres:
    image: postgres:${pgVersion}
    container_name: pgforge-${name}-pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${username}
      POSTGRES_PASSWORD: ${password}
      POSTGRES_DB: ${database}
    volumes:
      - ${dbPath}/data:/var/lib/postgresql/data
    ports:
      - "${port}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${username} -d ${database}"]
      interval: 5s
      timeout: 5s
      retries: 5
    command:
      - "postgres"
      - "-c"
      - "max_connections=${POSTGRES_DEFAULTS.maxConnections}"
      - "-c"
      - "shared_buffers=${POSTGRES_DEFAULTS.sharedBuffers}"
      - "-c"
      - "listen_addresses=*"

networks:
  default:
    name: pgforge-${name}-net
`;
  }

  // Production setup with PgBouncer for serverless compatibility
  // Security: App user has no superuser privileges (cannot run COPY PROGRAM, etc.)
  return `# PgForge managed database: ${name}
# Architecture: PostgreSQL (internal) -> PgBouncer (exposed)
# Optimized for serverless environments with connection pooling
# Security: Application user is NOT a superuser
version: "3.8"

services:
  postgres:
    image: postgres:${pgVersion}
    container_name: pgforge-${name}-pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: pgadmin
      POSTGRES_PASSWORD: ${adminPassword}
      POSTGRES_DB: ${database}
      APP_USER: ${username}
      APP_PASSWORD: ${password}
    volumes:
      - ${dbPath}/data:/var/lib/postgresql/data
      - ${dbPath}/init:/docker-entrypoint-initdb.d:ro
    networks:
      - internal
    # NOT exposed to host - only accessible via internal network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pgadmin -d ${database}"]
      interval: 5s
      timeout: 5s
      retries: 5
    command:
      - "postgres"
      - "-c"
      - "max_connections=${POSTGRES_DEFAULTS.maxConnections}"
      - "-c"
      - "shared_buffers=${POSTGRES_DEFAULTS.sharedBuffers}"
      - "-c"
      - "listen_addresses=*"
      - "-c"
      - "password_encryption=md5"

  pgbouncer:
    image: ${PGBOUNCER_DEFAULTS.image}
    container_name: pgforge-${name}-bouncer
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${username}:${password}@postgres:5432/${database}
      POOL_MODE: ${PGBOUNCER_DEFAULTS.poolMode}
      DEFAULT_POOL_SIZE: ${PGBOUNCER_DEFAULTS.defaultPoolSize}
      MAX_CLIENT_CONN: ${PGBOUNCER_DEFAULTS.maxClientConn}
      MAX_DB_CONNECTIONS: ${PGBOUNCER_DEFAULTS.maxDbConnections}
      AUTH_TYPE: md5
      IGNORE_STARTUP_PARAMETERS: extra_float_digits
    ports:
      - "${port}:5432"
    networks:
      - internal
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "pg_isready", "-h", "localhost", "-p", "5432"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  internal:
    name: pgforge-${name}-internal
    driver: bridge
    internal: false  # Required for health checks, but postgres has no port mapping
`;
}

/**
 * Generate the init script that creates the restricted app user
 * This runs once when the database is first created
 */
export function generateInitScript(options: {
  username: string;
  password: string;
  database: string;
}): string {
  const { username, password, database } = options;

  // Create a non-superuser with full access to the database but no dangerous privileges
  // Note: Username is quoted with double quotes because it may contain hyphens
  return `#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "pgadmin" --dbname "${database}" <<-EOSQL
  -- Create application user (NOT a superuser)
  CREATE USER "${username}" WITH PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;

  -- Grant full access to the database
  GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${username}";

  -- Grant schema permissions
  GRANT ALL ON SCHEMA public TO "${username}";
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${username}";
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${username}";

  -- Set default privileges for future objects
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${username}";
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${username}";
EOSQL
`;
}

/**
 * Generate a backup script for a database
 * Uses pgadmin (superuser) for backups, not the app user
 */
export function generateBackupScript(options: {
  name: string;
  database: string;
}): string {
  const { name, database } = options;
  const dbPath = getDatabasePath(name);

  return `#!/bin/bash
# PgForge backup script for ${name}
set -e

BACKUP_DIR="${dbPath}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="\${BACKUP_DIR}/${name}_\${TIMESTAMP}.sql.gz"

mkdir -p "\${BACKUP_DIR}"

docker exec pgforge-${name}-pg pg_dump -U pgadmin ${database} | gzip > "\${BACKUP_FILE}"

echo "\${BACKUP_FILE}"
`;
}

/**
 * Generate a restore script for a database
 * Uses pgadmin (superuser) for restores
 */
export function generateRestoreScript(options: {
  name: string;
  database: string;
  backupFile: string;
}): string {
  const { name, database, backupFile } = options;

  return `#!/bin/bash
# PgForge restore script for ${name}
set -e

gunzip -c "${backupFile}" | docker exec -i pgforge-${name}-pg psql -U pgadmin ${database}

echo "Restore completed successfully"
`;
}

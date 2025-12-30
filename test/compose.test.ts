import { test, expect } from "bun:test";
import { generateComposeFile, generateBackupScript, generateRestoreScript, generateInitScript } from "../src/lib/compose";

const testOptions = {
  name: "testdb",
  port: 54320,
  username: "testuser",
  password: "testpass123",
  database: "testdb",
  adminPassword: "adminpass456",
};

test("generateComposeFile creates valid YAML with pooler", () => {
  const compose = generateComposeFile({ ...testOptions, enablePooler: true });

  // Check for EasyPG branding and security note
  expect(compose).toContain("# EasyPG managed database: testdb");
  expect(compose).toContain("# Security: Application user is NOT a superuser");

  // Check postgres service uses pgadmin (internal superuser)
  expect(compose).toContain("postgres:");
  expect(compose).toContain("image: postgres:16-alpine");
  expect(compose).toContain("container_name: easypg-testdb-pg");
  expect(compose).toContain("POSTGRES_USER: pgadmin");
  expect(compose).toContain("POSTGRES_PASSWORD: adminpass456");
  expect(compose).toContain("POSTGRES_DB: testdb");

  // Check app user is passed to init script
  expect(compose).toContain("APP_USER: testuser");
  expect(compose).toContain("APP_PASSWORD: testpass123");

  // Check pgbouncer uses app user (not pgadmin)
  expect(compose).toContain("pgbouncer:");
  expect(compose).toContain("container_name: easypg-testdb-bouncer");
  expect(compose).toContain("DATABASES_USER: testuser");
  expect(compose).toContain("DATABASES_PASSWORD: testpass123");
  expect(compose).toContain(`"${testOptions.port}:5432"`);

  // Check network
  expect(compose).toContain("name: easypg-testdb-internal");
});

test("generateComposeFile creates YAML without pooler", () => {
  const compose = generateComposeFile({ ...testOptions, enablePooler: false });

  // Should have postgres but not pgbouncer
  expect(compose).toContain("postgres:");
  expect(compose).not.toContain("pgbouncer:");

  // Port should be on postgres directly
  expect(compose).toContain(`"${testOptions.port}:5432"`);

  // Different network name
  expect(compose).toContain("name: easypg-testdb-net");
});

test("generateComposeFile includes healthcheck", () => {
  const compose = generateComposeFile(testOptions);

  expect(compose).toContain("healthcheck:");
  expect(compose).toContain("pg_isready");
  expect(compose).toContain("interval: 5s");
  expect(compose).toContain("timeout: 5s");
  expect(compose).toContain("retries: 5");
});

test("generateBackupScript creates valid bash script using pgadmin", () => {
  const script = generateBackupScript({
    name: "testdb",
    database: "testdb",
  });

  expect(script).toContain("#!/bin/bash");
  expect(script).toContain("# EasyPG backup script for testdb");
  expect(script).toContain("set -e");
  expect(script).toContain("docker exec easypg-testdb-pg pg_dump -U pgadmin");
  expect(script).toContain("gzip");
});

test("generateRestoreScript creates valid bash script using pgadmin", () => {
  const script = generateRestoreScript({
    name: "testdb",
    database: "testdb",
    backupFile: "/path/to/backup.sql.gz",
  });

  expect(script).toContain("#!/bin/bash");
  expect(script).toContain("# EasyPG restore script for testdb");
  expect(script).toContain("gunzip -c");
  expect(script).toContain("docker exec -i easypg-testdb-pg psql -U pgadmin");
});

test("generateInitScript creates restricted app user", () => {
  const script = generateInitScript({
    username: "appuser",
    password: "apppass123",
    database: "mydb",
  });

  expect(script).toContain("#!/bin/bash");
  expect(script).toContain('--username "pgadmin"');
  expect(script).toContain("CREATE USER appuser WITH PASSWORD 'apppass123' NOSUPERUSER NOCREATEDB NOCREATEROLE");
  expect(script).toContain("GRANT ALL PRIVILEGES ON DATABASE mydb TO appuser");
});

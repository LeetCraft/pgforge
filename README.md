# PgForge

Serverless PostgreSQL databases made simple. Spin up production-ready PostgreSQL instances with connection pooling in seconds.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/pgforge/main/install.sh | bash
```

The installer will:
- Download the binary for your platform
- Install to `~/.pgforge/bin/`
- Add to your PATH

Re-running the installer will upgrade to the latest version.

## Quick Start

```bash
# Initialize PgForge
pgforge setup

# Create a database
pgforge create --name myapp

# That's it! You get a connection URL like:
# postgresql://usr_abc123:password@your-ip:19001/myapp
```

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `pgforge setup` | Initialize and check requirements |
| `pgforge create --name <name>` | Create a new database |
| `pgforge list` / `pgforge ls` | List all databases |
| `pgforge connect` | Show all connection URLs |
| `pgforge inspect --name <name>` | Detailed database info |
| `pgforge start --name <name>` | Start a stopped database |
| `pgforge start --all` | Start all stopped databases |
| `pgforge stop --name <name>` | Stop a database |
| `pgforge stop --all` | Stop all running databases |
| `pgforge destroy --name <name>` | Delete a database permanently |
| `pgforge rename --from <old> --to <new>` | Rename a database |
| `pgforge update` | Update PgForge to latest version |
| `pgforge uninstall` | Completely remove PgForge |

### Backup & Restore

| Command | Description |
|---------|-------------|
| `pgforge backup --name <name> --path <file.epg>` | Create portable encrypted backup |
| `pgforge restore --path <file.epg>` | Restore from backup |
| `pgforge restore --path <file.epg> --name <new-name>` | Restore with different name |

Backup features:
- **Portable**: Works across any PgForge installation
- **Encrypted**: Optional password encryption
- **Compressed**: Automatic gzip compression
- **Complete**: Includes all data, credentials, and settings

### S3 Automated Backups

| Command | Description |
|---------|-------------|
| `pgforge s3 configure <url>` | Configure S3-compatible storage |
| `pgforge s3 interval <hours>` | Set backup frequency (hours) |
| `pgforge s3 enable` | Enable automated backups |
| `pgforge s3 disable` | Disable automated backups |
| `pgforge s3 status` | Show S3 configuration and test connection |
| `pgforge s3 backup --name <name>` | Run manual backup now |
| `pgforge s3 list` | List all backups in S3 |
| `pgforge s3 restore --key <key>` | Restore from S3 backup |
| `pgforge s3 remove` | Remove S3 configuration |

Supports any S3-compatible storage (AWS S3, Backblaze B2, MinIO, R2, etc.)

### Web Panel

| Command | Description |
|---------|-------------|
| `pgforge web enable` | Start web management panel (port 56432) |
| `pgforge web enable --public` | Bind to 0.0.0.0 (default: 127.0.0.1) |
| `pgforge web enable --port <port>` | Use custom port |
| `pgforge web disable` | Stop the web panel |
| `pgforge web status` | Check web panel status |

Features:
- Password-protected access
- Create and manage databases
- Real-time metrics and monitoring
- Connection URL management
- Table browsing and schema exploration

### Settings

| Command | Description |
|---------|-------------|
| `pgforge settings logs enable` | Enable daemon logging |
| `pgforge settings logs disable` | Disable daemon logging |
| `pgforge settings logs status` | Check logging status |
| `pgforge settings daemon status` | Check background service |
| `pgforge settings daemon restart` | Restart background service |

## Examples

### Create a database

```bash
pgforge create --name my-saas-app
```

Output with new design:
```
✓ Database "my-saas-app" created successfully!

┌─ 🐘 Database Credentials
│
│ Name      my-saas-app
│ Host      203.0.113.50
│ Port      19001
│ Username  usr_x7kj2m9p
│ Password  aB3kL9mNpQ2rS5tU8vW
│ Database  my_saas_app
│
└──────────────────────────────────

┌─ Connection
│
│ URL  postgresql://usr_x7kj2m9p:aB3kL9...@203.0.113.50:19001/my_saas_app
│
└──────────────────────────────────
```

### Backup and Restore

```bash
# Create an encrypted backup
pgforge backup --name production --path ./prod-backup.epg

# Restore to same name
pgforge restore --path ./prod-backup.epg

# Restore with different name
pgforge restore --path ./prod-backup.epg --name production-copy
```

### S3 Automated Backups

```bash
# Configure S3 (supports AWS S3, B2, MinIO, R2, etc.)
pgforge s3 configure s3://my-backups?endpoint=https://s3.us-west-2.amazonaws.com&access_key=xxx&secret_key=xxx

# Set backup frequency to every 6 hours
pgforge s3 interval 6

# Enable automated backups
pgforge s3 enable

# Check status
pgforge s3 status

# List backups
pgforge s3 list

# Restore from S3
pgforge s3 restore --key backups/production_2024-01-01.epg
```

### Multiple Databases

```bash
pgforge create --name staging
pgforge create --name production
pgforge create --name analytics

pgforge list
```

### Web Management Panel

```bash
# Start on localhost (secure)
pgforge web enable

# Start on all interfaces (accessible remotely)
pgforge web enable --public

# Custom port
pgforge web enable --port 8080
```

Access at `http://your-server:56432`

## Architecture

Each database runs as a Docker Compose stack:

```
┌─────────────────────────────────────────────┐
│                   Internet                   │
└─────────────────────┬───────────────────────┘
                      │ :19001+
┌─────────────────────▼───────────────────────┐
│              PgBouncer                       │
│         (Connection Pooling)                 │
│      Transaction mode, 1000 connections      │
└─────────────────────┬───────────────────────┘
                      │ internal network
┌─────────────────────▼───────────────────────┐
│             PostgreSQL 16                    │
│         (Not exposed publicly)               │
│        Data persisted to disk                │
└─────────────────────────────────────────────┘
```

- **PgBouncer** handles connection pooling, perfect for serverless
- **PostgreSQL** runs on an internal network, not exposed to the internet
- Each database gets a unique port from the range 19001-19999
- Ports are permanently assigned to database names

## Ports

PgForge uses the following port ranges:

| Service | Port(s) | Description |
|---------|---------|-------------|
| Web Panel | 56432 | Web management interface |
| Databases | 19001-19999 | PostgreSQL databases (via PgBouncer) |

Each database is assigned a unique port that persists across restarts. With 999 available ports, you can run up to 999 databases simultaneously.

## Metrics & Auto-Restart

PgForge runs a background service that:
- Collects resource usage metrics every second
- Automatically restarts all databases on system boot
- Stores metrics in SQLite for historical charts
- Manages automated S3 backups (when configured)

The background service starts automatically during `pgforge setup` and is configured to start on boot.

```bash
# Check background service status
pgforge settings daemon status

# Restart background service if needed
pgforge settings daemon restart

# Enable logging to see what the service is doing
pgforge settings logs enable

# View metrics in the web panel
pgforge web enable
```

Auto-start uses systemd user services. Supported distributions include Ubuntu, Debian, Fedora, CentOS, RHEL, Arch, and other systemd-based Linux distributions.

## Data Location

All data is stored in `~/.pgforge/`:

```
~/.pgforge/
├── bin/             # PgForge binary
├── config/          # CLI configuration
│   ├── config.json  # Settings
│   ├── s3.json      # S3 configuration
│   └── web.json     # Web panel config
├── state/           # Port allocations, database registry
│   ├── state.json   # Database state
│   ├── ports.json   # Port allocations
│   ├── metrics.db   # SQLite metrics database
│   └── daemon.log   # Background service logs
└── databases/       # Per-database data
    └── myapp/
        ├── data/    # PostgreSQL data files
        ├── backups/ # Local backup files
        ├── init/    # Initialization scripts
        └── docker-compose.yml
```

## Custom Install Path

You can specify a custom installation directory using the `PGFORGE_HOME` environment variable:

```bash
export PGFORGE_HOME=/mnt/data/pgforge
pgforge setup
```

This is useful for:
- Installing on a different disk with more space
- Using a mounted network drive
- Running in containerized environments

## Updating

```bash
pgforge update
```

Or reinstall:

```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/pgforge/main/install.sh | bash
```

## Uninstall

```bash
pgforge uninstall
```

This will:
- Stop and remove all database containers
- Remove Docker volumes
- Stop and remove the systemd service
- Remove the `~/.pgforge` directory
- Clean up PATH entries from shell configs

## Requirements

- Docker or Docker Compose
- Linux (Ubuntu, Debian, Fedora, CentOS, RHEL, Arch, etc.)
- macOS (Docker Desktop required)
- systemd (for auto-restart feature)

## Security

- Web panel is password-protected
- Defaults to localhost-only binding (use `--public` for remote access)
- PostgreSQL not exposed directly (only via PgBouncer)
- Internal Docker network isolation
- Encrypted backups with password protection
- S3 credentials stored securely in config files

## License

MIT

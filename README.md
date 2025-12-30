# PgForge

Serverless PostgreSQL databases made simple. Spin up production-ready PostgreSQL instances with connection pooling in seconds.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/CyberClarence/pgforge/main/install.sh | bash
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
# postgresql://db_abc123:password@your-ip:75001/myapp
```

## Commands

| Command | Description |
|---------|-------------|
| `pgforge setup` | Initialize and check requirements |
| `pgforge create --name <name>` | Create a new database |
| `pgforge list` | List all databases |
| `pgforge connect` | Show all connection URLs |
| `pgforge inspect --name <name>` | Detailed database info |
| `pgforge stop --name <name>` | Stop a database |
| `pgforge start --name <name>` | Start a stopped database |
| `pgforge backup --name <name>` | Backup a database |
| `pgforge restore --name <name>` | Restore from backup |
| `pgforge destroy --name <name>` | Delete a database permanently |
| `pgforge update` | Update PgForge to latest version |
| `pgforge uninstall` | Completely remove PgForge |
| `pgforge web enable` | Start the web management panel |
| `pgforge web disable` | Stop the web panel |
| `pgforge web status` | Check web panel status |
| `pgforge settings logs enable` | Enable background service logging |
| `pgforge settings logs disable` | Disable background service logging |
| `pgforge settings daemon status` | Check background service status |
| `pgforge settings daemon restart` | Restart background service |

## Examples

### Create a database for your project

```bash
pgforge create --name my-saas-app
```

Output:
```
✓ Database "my-saas-app" created successfully!

╭──────────────────────── 🐘 PostgreSQL ─────────────────────────╮
│                                                                 │
│   Database: my-saas-app                                         │
│                                                                 │
│   Host:     203.0.113.50                                        │
│   Port:     75001                                               │
│   User:     db_x7kj2m9p                                         │
│   Password: aB3kL9mNpQ2rS5tU8vW1xY4zA7cD0eF                     │
│   Database: my_saas_app                                         │
│                                                                 │
│   Connection URL:                                               │
│   postgresql://db_x7kj2m9p:aB3kL9mNpQ2...@203.0.113.50:75001/   │
│   my_saas_app                                                   │
│                                                                 │
╰─────────────────────────────────────────────────────────────────╯
```

### Use in your application

```bash
# Set environment variable
export DATABASE_URL=$(pgforge connect | grep my-saas-app -A1 | tail -1 | xargs)

# Or add to .env
pgforge connect  # Copy the URL from output
```

### Multiple databases

```bash
pgforge create --name staging
pgforge create --name production
pgforge create --name analytics

pgforge list
```

### Backup before risky operations

```bash
pgforge backup --name production
# Make your changes...
# If something goes wrong:
pgforge restore --name production
```

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
| Web Panel | 19000 | Web management interface |
| Databases | 19001-19999 | PostgreSQL databases (via PgBouncer) |

Each database is assigned a unique port that persists across restarts. With 999 available ports, you can run up to 999 databases simultaneously.

## Web Panel

PgForge includes a web-based management panel for creating and monitoring databases.

```bash
# Start the web panel (default port: 19000)
pgforge web enable

# Access at http://your-server:19000
```

Features:
- Password-protected access
- View all databases with status
- Create new databases
- Start/stop databases
- Copy connection URLs
- Real-time resource usage charts (CPU, memory, connections, disk)
- Time period selectors (24h, 7d, 30d, custom)

## Metrics & Auto-Restart

PgForge runs a background service that:
- Collects resource usage metrics every 60 seconds
- Automatically restarts all databases on system boot
- Stores metrics in SQLite for historical charts

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
├── state/           # Port allocations, database registry
└── databases/       # Per-database data
    └── myapp/
        ├── data/    # PostgreSQL data files
        ├── backups/ # Backup files
        └── docker-compose.yml
```

## Updating

```bash
pgforge update
```

Or reinstall:

```bash
curl -fsSL https://raw.githubusercontent.com/CyberClarence/pgforge/main/install.sh | bash
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

## License

MIT

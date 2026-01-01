#!/usr/bin/env bun

// Ensure PATH includes common binary directories for docker and other tools
// This is critical when running via nohup or systemd where PATH may be minimal
const additionalPaths = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
process.env.PATH = `${additionalPaths}:${process.env.PATH || ""}`;

import { Command } from "commander";
import { setup } from "./commands/setup";
import { create } from "./commands/create";
import { list } from "./commands/list";
import { stop } from "./commands/stop";
import { start } from "./commands/start";
import { backup } from "./commands/backup";
import { restore } from "./commands/restore";
import { inspect } from "./commands/inspect";
import { connect } from "./commands/connect";
import { destroy } from "./commands/destroy";
import { rename } from "./commands/rename";
import { update } from "./commands/update";
import { uninstall } from "./commands/uninstall";
import { webEnable, webDisable, webStatus } from "./commands/web";
import {
  s3Configure,
  s3Interval,
  s3Status,
  s3Enable,
  s3Disable,
  s3Remove,
  s3Backup,
  s3List,
  s3Restore,
} from "./commands/s3";
import {
  ensureDaemonRunning,
  stopDaemon,
  runDaemonLoop,
  setLogsEnabled,
  getLogsEnabled,
  getDaemonHealth,
  getDaemonPid,
} from "./lib/daemon";
import { getConfig } from "./lib/fs";
import { VERSION, setPgforgeHome } from "./lib/constants";
import * as ui from "./lib/ui";

const program = new Command();

program
  .name("pgforge")
  .description("Serverless PostgreSQL databases made simple")
  .version(VERSION)
  .hook("preAction", async (thisCommand) => {
    // Skip config check for setup, update, and uninstall commands
    const skipConfigCheck = ["setup", "update", "uninstall"];
    if (!skipConfigCheck.includes(thisCommand.args[0])) {
      const config = await getConfig();
      if (!config.initialized) {
        ui.warning("PgForge has not been set up yet.");
        ui.info("Run 'pgforge setup' first to initialize.");
        process.exit(1);
      }
      // Restore the saved storage path from config
      if (config.pgforgeHome) {
        setPgforgeHome(config.pgforgeHome);
      }
    }
  });

// Setup command
program
  .command("setup")
  .description("Initialize PgForge and check system requirements")
  .action(setup);

// Create command
program
  .command("create")
  .description("Create a new PostgreSQL database")
  .requiredOption("-n, --name <name>", "Database name (alphanumeric, lowercase)")
  .option("-u, --username <username>", "Custom username (auto-generated if not provided)")
  .option("-p, --password <password>", "Custom password (auto-generated if not provided)")
  .option("-d, --database <database>", "Database name inside PostgreSQL (defaults to --name)")
  .option("--no-pooler", "Disable PgBouncer connection pooling")
  .action(create);

// List command
program
  .command("list")
  .alias("ls")
  .description("List all databases")
  .action(list);

// Start command
program
  .command("start")
  .description("Start a stopped database")
  .option("-n, --name <name>", "Database name")
  .option("-a, --all", "Start all stopped databases")
  .action(start);

// Stop command
program
  .command("stop")
  .description("Stop a running database")
  .option("-n, --name <name>", "Database name")
  .option("-a, --all", "Stop all running databases")
  .action(stop);

// Backup command
program
  .command("backup")
  .description("Create a portable backup archive of a database")
  .option("-n, --name <name>", "Database name")
  .requiredOption("-p, --path <path>", "Output file path (.epg archive)")
  .option("--no-pass", "Skip encryption password prompt")
  .action(backup);

// Restore command
program
  .command("restore")
  .description("Restore a database from a portable backup archive")
  .requiredOption("-p, --path <path>", "Backup archive file path (.epg)")
  .option("-n, --name <name>", "Override database name (defaults to original)")
  .action(restore);

// Inspect command
program
  .command("inspect")
  .description("Show detailed information about a database")
  .option("-n, --name <name>", "Database name")
  .option("-l, --logs", "Include recent logs")
  .action(inspect);

// Connect command
program
  .command("connect")
  .description("Show connection details for all databases")
  .action(connect);

// Destroy command
program
  .command("destroy")
  .alias("rm")
  .description("Permanently delete a database and all its data")
  .option("-n, --name <name>", "Database name")
  .option("-f, --force", "Skip confirmation prompt")
  .action(destroy);

// Rename command
program
  .command("rename")
  .alias("mv")
  .description("Rename a database (connection URL stays the same)")
  .option("--from <name>", "Current database name")
  .option("--to <name>", "New database name")
  .option("-f, --force", "Skip confirmation prompt")
  .action(rename);

// Update command
program
  .command("update")
  .description("Update PgForge to the latest version")
  .action(update);

// Uninstall command
program
  .command("uninstall")
  .description("Completely remove PgForge and all databases")
  .action(uninstall);

// Web command with subcommands
const web = program
  .command("web")
  .description("Manage the web panel");

web
  .command("enable")
  .description("Enable and start the web panel")
  .option("-p, --port <port>", "Port to run on")
  .option("--public", "Bind to 0.0.0.0 interface (default: 127.0.0.1)")
  .action(async (options) => {
    let port = options.port ? parseInt(options.port, 10) : undefined;

    if (!port) {
      // Prompt user for port
      process.stdout.write("Port to run web panel on: ");
      const reader = Bun.stdin.stream().getReader();
      let input = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        input += new TextDecoder().decode(value);
        if (input.includes("\n")) break;
      }
      reader.releaseLock();
      const inputPort = parseInt(input.trim(), 10);
      port = inputPort > 0 && inputPort < 65536 ? inputPort : 3000;
    }

    await webEnable({ port, public: options.public || false });
  });

web
  .command("disable")
  .description("Disable the web panel")
  .action(webDisable);

web
  .command("status")
  .description("Show web panel status")
  .action(webStatus);

// S3 backup command with subcommands
const s3 = program
  .command("s3")
  .description("Manage S3 automated backups");

s3
  .command("configure <url>")
  .description("Configure S3 backup with URL")
  .option("-i, --interval <hours>", "Backup interval in hours (default: 24)")
  .action(s3Configure);

s3
  .command("interval <hours>")
  .description("Set backup interval in hours")
  .action(s3Interval);

s3
  .command("status")
  .description("Show S3 backup status and test connection")
  .action(s3Status);

s3
  .command("enable")
  .description("Enable S3 backups (if previously configured)")
  .action(s3Enable);

s3
  .command("disable")
  .description("Disable S3 backups (keeps configuration)")
  .action(s3Disable);

s3
  .command("remove")
  .description("Remove S3 configuration completely")
  .action(s3Remove);

s3
  .command("backup")
  .description("Run backup manually (all databases or specific)")
  .option("-n, --name <name>", "Backup specific database only")
  .action(s3Backup);

s3
  .command("list")
  .description("List backups in S3")
  .option("-n, --name <name>", "Filter by database name")
  .action(s3List);

s3
  .command("restore")
  .description("Restore database from S3 backup")
  .requiredOption("-k, --key <key>", "S3 key of backup to restore")
  .option("-n, --name <name>", "Override database name")
  .action(s3Restore);

// Settings command with subcommands
const settings = program
  .command("settings")
  .description("Manage PgForge settings");

// Settings logs subcommand
const settingsLogs = settings
  .command("logs")
  .description("Manage daemon logging");

settingsLogs
  .command("enable")
  .description("Enable daemon logging")
  .action(async () => {
    await setLogsEnabled(true);
    ui.success("Daemon logging enabled");
    ui.info("Logs are written to ~/.pgforge/state/daemon.log");
  });

settingsLogs
  .command("disable")
  .description("Disable daemon logging")
  .action(async () => {
    await setLogsEnabled(false);
    ui.success("Daemon logging disabled");
  });

settingsLogs
  .command("status")
  .description("Check if logging is enabled")
  .action(async () => {
    const enabled = await getLogsEnabled();
    if (enabled) {
      ui.success("Logging is enabled");
      ui.info("Logs are written to ~/.pgforge/state/daemon.log");
    } else {
      ui.muted("Logging is disabled");
    }
  });

// Settings daemon subcommand (for advanced users)
const settingsDaemon = settings
  .command("daemon")
  .description("Manage background service");

settingsDaemon
  .command("status")
  .description("Check if background service is running")
  .action(async () => {
    const health = await getDaemonHealth();
    const pid = await getDaemonPid();

    if (health.running && health.healthy) {
      ui.success("Background service is running and healthy");
      if (pid) {
        ui.printKeyValue("PID", String(pid));
      }
      if (health.uptime) {
        const uptimeSeconds = Math.floor(health.uptime / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        ui.printKeyValue("Uptime", `${hours}h ${minutes}m ${seconds}s`);
      }
      if (health.lastHeartbeat) {
        const ago = Math.floor((Date.now() - health.lastHeartbeat) / 1000);
        ui.printKeyValue("Last heartbeat", `${ago}s ago`);
      }
    } else if (health.running && !health.healthy) {
      ui.warning("Background service is running but unhealthy");
      ui.info("Run 'pgforge settings daemon restart' to restart it");
    } else {
      ui.error("Background service is not running");
      ui.info("Run 'pgforge settings daemon restart' to start it");
    }
  });

settingsDaemon
  .command("restart")
  .description("Restart the background service")
  .action(async () => {
    const spin = ui.spinner("Restarting background service...");
    spin.start();

    await stopDaemon();
    await Bun.sleep(1000);
    const result = await ensureDaemonRunning();

    if (result.success) {
      spin.succeed("Background service restarted");
    } else {
      spin.fail("Failed to restart background service");
      ui.error(result.message);
      process.exit(1);
    }
  });

// Hidden daemon run command (used internally by autostart services)
program
  .command("daemon")
  .description("Internal daemon commands")
  .command("run")
  .description("Run the daemon loop (internal use only)")
  .action(async () => {
    await runDaemonLoop();
  });

// Parse arguments
program.parse();

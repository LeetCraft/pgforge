import { checkDocker } from "../lib/docker";
import { ensureDirectories, getConfig, saveConfig } from "../lib/fs";
import { getPublicIp } from "../lib/network";
import { ensureDaemonRunning, installAutostart } from "../lib/daemon";
import * as ui from "../lib/ui";

export async function setup(): Promise<void> {
  ui.printBanner();

  const spin = ui.spinner("Checking system requirements...");
  spin.start();

  // Check Docker
  const docker = await checkDocker();

  if (!docker.installed) {
    spin.fail("Docker is not installed");
    console.log();
    ui.error("Docker is required to run PgForge.");
    console.log();
    ui.info("Install Docker with the official script:");
    console.log();
    console.log("  curl -fsSL https://get.docker.com -o get-docker.sh");
    console.log("  sudo sh ./get-docker.sh");
    console.log("  sudo systemctl restart docker");
    console.log();
    ui.muted("Then run 'pgforge setup' again.");
    process.exit(1);
  }

  if (!docker.running) {
    if (docker.permissionDenied) {
      spin.fail("Docker permission denied");
      console.log();
      ui.error("You don't have permission to access Docker.");
      console.log();

      ui.info("To fix this, run:");
      console.log();
      console.log("  sudo usermod -aG docker $USER");
      console.log("  newgrp docker");
      console.log("  pgforge setup");
      console.log();
      ui.muted("This adds you to the docker group and activates it in your current session.");
    } else {
      spin.fail("Docker is not running");
      console.log();
      ui.error("Docker daemon is not running. Please start Docker and try again.");
      ui.info("Run: sudo systemctl start docker");
    }
    process.exit(1);
  }

  if (!docker.compose) {
    spin.fail("Docker Compose is not available");
    console.log();
    ui.error("Docker Compose V2 is required but not found.");
    console.log();
    ui.warning("You may have installed 'docker.io' or 'podman-docker' instead of official Docker.");
    ui.info("Install official Docker with:");
    console.log();
    console.log("  curl -fsSL https://get.docker.com | sh");
    console.log();
    ui.muted("Or follow: https://docs.docker.com/engine/install/");
    process.exit(1);
  }

  spin.succeed("Docker and Docker Compose are ready");

  // Create directories
  const dirSpin = ui.spinner("Creating data directories...");
  dirSpin.start();
  await ensureDirectories();
  dirSpin.succeed("Data directories created");

  // Detect public IP
  const ipSpin = ui.spinner("Detecting public IP address...");
  ipSpin.start();

  const publicIp = await getPublicIp();

  if (publicIp) {
    ipSpin.succeed(`Public IP detected: ${ui.brand.highlight(publicIp)}`);
  } else {
    ipSpin.warn("Could not detect public IP (will use localhost)");
    ui.warning("Databases will only be accessible locally.");
    ui.info("To expose databases publicly, ensure your server has a public IP.");
  }

  // Save configuration
  const config = await getConfig();
  config.initialized = true;
  config.publicIp = publicIp;
  config.createdAt = new Date().toISOString();
  await saveConfig(config);

  // Start background daemon and install autostart
  const daemonSpin = ui.spinner("Starting background service...");
  daemonSpin.start();

  // Install system autostart service
  await installAutostart();

  // Start daemon immediately
  const daemonResult = await ensureDaemonRunning();
  if (daemonResult.success) {
    daemonSpin.succeed("Background service started (auto-starts on boot)");
  } else {
    daemonSpin.warn("Background service started (autostart may need manual setup)");
  }

  console.log();
  ui.success("PgForge is ready to use!");
  console.log();

  ui.printSection("Quick Start");
  ui.printKeyValue("Create database", "pgforge create --name myapp");
  ui.printKeyValue("List databases", "pgforge list");
  ui.printKeyValue("View connections", "pgforge connect");

  console.log();
  ui.muted("Run 'pgforge --help' for all available commands.");
}

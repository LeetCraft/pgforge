import { homedir } from "os";
import { join } from "path";
import * as ui from "../lib/ui";
import { getDockerPath } from "../lib/docker";

export async function uninstall(): Promise<void> {
  ui.printBanner();

  console.log();
  ui.warning("This will completely remove PgForge and all databases.");
  console.log();

  const confirmed = await ui.confirm("Are you sure you want to uninstall PgForge?");
  if (!confirmed) {
    ui.info("Uninstall cancelled.");
    return;
  }

  console.log();
  let errors: string[] = [];
  const d = await getDockerPath();

  // 1. Stop all databases
  const dbSpin = ui.spinner("Stopping all databases...");
  dbSpin.start();
  try {
    const result = await Bun.$`${{ raw: d }} ps -a --filter "name=pgforge-" -q`.quiet().nothrow();
    const containers = result.text().trim().split("\n").filter(Boolean);
    if (containers.length > 0) {
      for (const container of containers) {
        await Bun.$`${{ raw: d }} rm -f ${container}`.quiet().nothrow();
      }
      dbSpin.succeed(`Stopped ${containers.length} database container(s)`);
    } else {
      dbSpin.succeed("No database containers found");
    }
  } catch (err) {
    dbSpin.fail("Failed to stop databases");
    errors.push(`Databases: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Remove Docker networks
  const netSpin = ui.spinner("Removing Docker networks...");
  netSpin.start();
  try {
    const result = await Bun.$`${{ raw: d }} network ls --filter "name=pgforge-" -q`.quiet().nothrow();
    const networks = result.text().trim().split("\n").filter(Boolean);
    if (networks.length > 0) {
      for (const network of networks) {
        await Bun.$`${{ raw: d }} network rm ${network}`.quiet().nothrow();
      }
      netSpin.succeed(`Removed ${networks.length} Docker network(s)`);
    } else {
      netSpin.succeed("No Docker networks found");
    }
  } catch (err) {
    netSpin.fail("Failed to remove Docker networks");
    errors.push(`Networks: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Remove Docker volumes
  const volSpin = ui.spinner("Removing Docker volumes...");
  volSpin.start();
  try {
    const result = await Bun.$`${{ raw: d }} volume ls --filter "name=pgforge-" -q`.quiet().nothrow();
    const volumes = result.text().trim().split("\n").filter(Boolean);
    if (volumes.length > 0) {
      for (const volume of volumes) {
        await Bun.$`${{ raw: d }} volume rm ${volume}`.quiet().nothrow();
      }
      volSpin.succeed(`Removed ${volumes.length} Docker volume(s)`);
    } else {
      volSpin.succeed("No Docker volumes found");
    }
  } catch (err) {
    volSpin.fail("Failed to remove Docker volumes");
    errors.push(`Volumes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Stop and disable systemd service
  const svcSpin = ui.spinner("Removing systemd service...");
  svcSpin.start();
  try {
    await Bun.$`systemctl --user stop pgforge.service`.quiet().nothrow();
    await Bun.$`systemctl --user disable pgforge.service`.quiet().nothrow();
    const servicePath = join(homedir(), ".config", "systemd", "user", "pgforge.service");
    await Bun.$`rm -f ${servicePath}`.quiet().nothrow();
    await Bun.$`systemctl --user daemon-reload`.quiet().nothrow();
    svcSpin.succeed("Removed systemd service");
  } catch (err) {
    svcSpin.fail("Failed to remove systemd service");
    errors.push(`Systemd: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Remove data directory
  const dataSpin = ui.spinner("Removing PgForge data directory...");
  dataSpin.start();
  try {
    const pgforgeHome = join(homedir(), ".pgforge");
    await Bun.$`rm -rf ${pgforgeHome}`.quiet().nothrow();
    dataSpin.succeed("Removed ~/.pgforge directory");
  } catch (err) {
    dataSpin.fail("Failed to remove data directory");
    errors.push(`Data: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6. Remove PATH entries from shell configs
  const pathSpin = ui.spinner("Removing PATH entries from shell configs...");
  pathSpin.start();
  try {
    const shellConfigs = [
      join(homedir(), ".bashrc"),
      join(homedir(), ".zshrc"),
      join(homedir(), ".profile"),
      join(homedir(), ".config", "fish", "config.fish"),
    ];

    for (const config of shellConfigs) {
      // Check if file exists and contains pgforge
      const exists = await Bun.file(config).exists();
      if (exists) {
        const content = await Bun.file(config).text();
        if (content.includes(".pgforge/bin") || content.includes("# PgForge")) {
          // Remove PgForge lines
          const newContent = content
            .split("\n")
            .filter(line => !line.includes(".pgforge/bin") && !line.includes("# PgForge"))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n"); // Clean up multiple blank lines
          await Bun.write(config, newContent);
        }
      }
    }
    pathSpin.succeed("Removed PATH entries from shell configs");
  } catch (err) {
    pathSpin.fail("Failed to remove PATH entries");
    errors.push(`PATH: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log();

  if (errors.length > 0) {
    ui.warning("Uninstall completed with some errors:");
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    console.log();
  } else {
    ui.success("PgForge has been completely uninstalled.");
  }

  console.log();
  ui.info("To complete the uninstall, restart your terminal or run:");
  console.log();
  console.log("  exec $SHELL");
  console.log();
}

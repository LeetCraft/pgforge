import * as ui from "../lib/ui";
import { VERSION } from "../lib/constants";
import { stopDaemon, ensureDaemonRunning, isDaemonRunning } from "../lib/daemon";

const REPO = "LeetCraft/pgforge";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/LeetCraft/pgforge/main/install.sh";

export async function update(): Promise<void> {
  const spin = ui.spinner("Checking for updates...");
  spin.start();

  try {
    // Get latest release info
    const response = await fetch(RELEASES_URL, {
      headers: { "User-Agent": "pgforge" },
    });

    if (!response.ok) {
      spin.fail("Failed to check for updates");
      ui.error("Could not reach GitHub. Check your internet connection.");
      process.exit(1);
    }

    const release = await response.json() as { tag_name: string };
    const latestVersion = release.tag_name.replace(/^v/, "");
    const currentVersion = VERSION;

    if (latestVersion === currentVersion) {
      spin.succeed(`Already on latest version (v${currentVersion})`);
      return;
    }

    spin.succeed(`New version available: v${latestVersion} (current: v${currentVersion})`);
    console.log();

    // Check if daemon is running and stop it
    const daemonWasRunning = await isDaemonRunning();
    if (daemonWasRunning) {
      const stopSpin = ui.spinner("Stopping daemon...");
      stopSpin.start();
      const stopResult = await stopDaemon();
      if (stopResult.success) {
        stopSpin.succeed("Daemon stopped");
      } else {
        stopSpin.warn("Could not stop daemon cleanly");
      }
      await Bun.sleep(1000);
    }

    // Run the install script
    ui.info("Running install script...");
    console.log();

    const result = await Bun.$`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`;

    if (result.exitCode !== 0) {
      ui.error("Installation failed");
      console.log();
      ui.muted("Try running manually:");
      ui.muted(`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`);
      process.exit(1);
    }

    console.log();
    ui.success(`Updated to v${latestVersion}!`);

    // Restart daemon if it was running before
    if (daemonWasRunning) {
      const restartSpin = ui.spinner("Restarting daemon...");
      restartSpin.start();
      await Bun.sleep(500);

      const startResult = await ensureDaemonRunning();
      if (startResult.success) {
        restartSpin.succeed("Daemon restarted");
      } else {
        restartSpin.fail("Failed to restart daemon");
        ui.warning("Run 'pgforge settings daemon restart' to manually restart.");
      }
    }

    console.log();
    ui.muted("Run 'pgforge --version' to verify.");
  } catch (err) {
    spin.fail("Update failed");
    ui.error(err instanceof Error ? err.message : String(err));
    console.log();
    ui.muted("Try reinstalling manually:");
    ui.muted(`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`);
    process.exit(1);
  }
}

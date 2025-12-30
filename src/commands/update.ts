import { homedir } from "os";
import { join } from "path";
import * as ui from "../lib/ui";
import { VERSION } from "../lib/constants";
import { stopDaemon, ensureDaemonRunning, isDaemonRunning } from "../lib/daemon";

const REPO = "CyberClarence/pgforge";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALL_DIR = join(homedir(), ".pgforge", "bin");

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

    const release = await response.json() as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
    const latestVersion = release.tag_name.replace(/^v/, "");

    // Get current version from constants
    const currentVersion = VERSION;

    if (latestVersion === currentVersion) {
      spin.succeed(`Already on latest version (v${currentVersion})`);
      return;
    }

    spin.succeed(`New version available: v${latestVersion} (current: v${currentVersion})`);

    // Verify platform
    const platform = process.platform;
    const arch = process.arch;

    if (platform !== "linux" && platform !== "darwin") {
      ui.error(`Unsupported platform: ${platform}. PgForge supports Linux and macOS.`);
      process.exit(1);
    }

    if (arch !== "x64" && arch !== "arm64") {
      ui.error(`Unsupported architecture: ${arch}. PgForge only supports x64 and arm64.`);
      process.exit(1);
    }

    const assetName = `pgforge-${platform}-${arch}`;

    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) {
      ui.error(`No binary found for ${assetName}`);
      ui.info("Try reinstalling with the install script.");
      process.exit(1);
    }

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
      // Give it a moment to fully stop
      await Bun.sleep(1000);
    }

    // Download and install
    const downloadSpin = ui.spinner(`Downloading ${assetName}...`);
    downloadSpin.start();

    const binaryResponse = await fetch(asset.browser_download_url);
    if (!binaryResponse.ok) {
      downloadSpin.fail("Download failed");
      process.exit(1);
    }

    const binary = await binaryResponse.arrayBuffer();
    downloadSpin.succeed("Downloaded");

    // Install
    const installSpin = ui.spinner("Installing...");
    installSpin.start();

    const installPath = join(INSTALL_DIR, "pgforge");
    const tempPath = "/tmp/pgforge-update";

    // Ensure install directory exists
    await Bun.$`mkdir -p ${INSTALL_DIR}`.quiet();

    await Bun.write(tempPath, binary);
    await Bun.$`chmod +x ${tempPath}`.quiet();
    await Bun.$`mv ${tempPath} ${installPath}`.quiet();

    installSpin.succeed(`Updated to v${latestVersion}`);

    // Restart daemon if it was running before
    if (daemonWasRunning) {
      const restartSpin = ui.spinner("Restarting daemon with new version...");
      restartSpin.start();

      // Small delay to ensure the new binary is fully in place
      await Bun.sleep(500);

      const startResult = await ensureDaemonRunning();
      if (startResult.success) {
        restartSpin.succeed("Daemon restarted");
      } else {
        restartSpin.fail("Failed to restart daemon");
        ui.warning("Run 'pgforge settings daemon restart' to manually restart the daemon.");
      }
    }

    console.log();
    ui.success("PgForge has been updated!");
    ui.muted("Run 'pgforge --version' to verify.");
  } catch (err) {
    spin.fail("Update failed");
    ui.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

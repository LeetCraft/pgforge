#!/bin/bash
set -e

# PgForge installer
# Usage: curl -fsSL https://raw.githubusercontent.com/CyberClarence/pgforge/main/install.sh | bash

REPO="CyberClarence/pgforge"
INSTALL_DIR="$HOME/.pgforge/bin"
BINARY_NAME="pgforge"
STATE_DIR="$HOME/.pgforge/state"
DAEMON_PID_FILE="$STATE_DIR/daemon.pid"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Detect OS and architecture (Linux x64 only)
detect_platform() {
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  case "$OS" in
    linux*) OS="linux" ;;
    *) error "Unsupported operating system: $OS. PgForge only supports Linux." ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) error "Unsupported architecture: $ARCH. PgForge only supports x64 and arm64." ;;
  esac

  # Verify systemd is available
  if ! command -v systemctl &> /dev/null; then
    error "systemd is required. PgForge only supports systemd-based Linux distributions."
  fi

  PLATFORM="${OS}-${ARCH}"
}

# Get latest release version
get_latest_version() {
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
  if [ -z "$VERSION" ]; then
    error "Could not fetch latest version"
  fi
}

# Stop the daemon if running
stop_daemon() {
  if [ -f "$DAEMON_PID_FILE" ]; then
    DAEMON_PID=$(cat "$DAEMON_PID_FILE" 2>/dev/null)
    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
      info "Stopping existing daemon (PID: $DAEMON_PID)..."
      kill -TERM "$DAEMON_PID" 2>/dev/null || true

      # Wait for daemon to stop (max 10 seconds)
      for i in $(seq 1 20); do
        if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
          success "Daemon stopped"
          DAEMON_WAS_RUNNING=true
          return 0
        fi
        sleep 0.5
      done

      # Force kill if still running
      kill -KILL "$DAEMON_PID" 2>/dev/null || true
      success "Daemon force stopped"
      DAEMON_WAS_RUNNING=true
    fi
  fi

  # Also try to stop via systemctl if service exists
  if systemctl --user is-active pgforge.service &>/dev/null; then
    info "Stopping systemd service..."
    systemctl --user stop pgforge.service 2>/dev/null || true
    DAEMON_WAS_RUNNING=true
    success "Systemd service stopped"
  fi
}

# Start the daemon after install
start_daemon() {
  if [ "$DAEMON_WAS_RUNNING" = true ] || [ "$IS_REINSTALL" = true ]; then
    info "Starting daemon with new version..."

    # Try systemd first
    if systemctl --user is-enabled pgforge.service &>/dev/null; then
      systemctl --user start pgforge.service 2>/dev/null
      sleep 2
      if systemctl --user is-active pgforge.service &>/dev/null; then
        success "Daemon started via systemd"
        return 0
      fi
    fi

    # Fall back to direct start
    if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
      nohup "${INSTALL_DIR}/${BINARY_NAME}" daemon run >> "$STATE_DIR/daemon.log" 2>&1 &
      sleep 2
      if [ -f "$DAEMON_PID_FILE" ]; then
        NEW_PID=$(cat "$DAEMON_PID_FILE" 2>/dev/null)
        if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
          success "Daemon started (PID: $NEW_PID)"
          return 0
        fi
      fi
      warn "Could not verify daemon started. Run 'pgforge settings daemon status' to check."
    fi
  fi
}

# Download and install binary
install_binary() {
  # Check for existing installation
  if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
    CURRENT_VERSION=$("${INSTALL_DIR}/${BINARY_NAME}" --version 2>/dev/null || echo "unknown")
    info "Existing installation found (v${CURRENT_VERSION})"
    IS_REINSTALL=true

    # Stop daemon before upgrade
    stop_daemon
  fi

  # Try platform-specific binary first, fall back to generic
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}-${PLATFORM}"
  FALLBACK_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}"
  TMP_FILE=$(mktemp)

  if [ "$IS_REINSTALL" = true ]; then
    info "Downloading PgForge v${VERSION} (upgrade)..."
  else
    info "Downloading PgForge v${VERSION} for ${PLATFORM}..."
  fi

  # Try platform-specific first
  if curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE" 2>/dev/null; then
    : # Success
  elif curl -fsSL "$FALLBACK_URL" -o "$TMP_FILE" 2>/dev/null; then
    info "Using universal binary"
  else
    rm -f "$TMP_FILE"
    error "Download failed. Check your internet connection."
  fi

  # Create install directory
  mkdir -p "$INSTALL_DIR"
  mkdir -p "$STATE_DIR"

  chmod +x "$TMP_FILE"
  mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"

  if [ "$IS_REINSTALL" = true ]; then
    success "Upgraded to PgForge v${VERSION}"
  else
    success "Installed PgForge v${VERSION}"
  fi
}

# Detect user's shell and config file
detect_shell_config() {
  SHELL_NAME="$(basename "$SHELL")"

  case "$SHELL_NAME" in
    zsh)
      SHELL_CONFIG="$HOME/.zshrc"
      ;;
    bash)
      SHELL_CONFIG="$HOME/.bashrc"
      ;;
    fish)
      SHELL_CONFIG="$HOME/.config/fish/config.fish"
      ;;
    *)
      # Default to .profile for other shells
      SHELL_CONFIG="$HOME/.profile"
      ;;
  esac
}

# Add to PATH in shell config
setup_path() {
  detect_shell_config

  EXPORT_LINE="export PATH=\"\$HOME/.pgforge/bin:\$PATH\""

  # Check if export line already exists in config file
  if [ -f "$SHELL_CONFIG" ] && grep -q ".pgforge/bin" "$SHELL_CONFIG"; then
    info "PATH already in $SHELL_CONFIG"
    return 0
  fi

  # Add to shell config
  info "Adding PgForge to PATH in $SHELL_CONFIG..."

  # Create config file if it doesn't exist
  touch "$SHELL_CONFIG"

  # Add export line
  echo "" >> "$SHELL_CONFIG"
  echo "# PgForge" >> "$SHELL_CONFIG"
  echo "$EXPORT_LINE" >> "$SHELL_CONFIG"

  success "Added to $SHELL_CONFIG"
}

# Verify installation
verify_install() {
  if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
    if [ "$IS_REINSTALL" = true ]; then
      success "PgForge upgraded successfully!"
      echo ""
      info "You're all set! PgForge v${VERSION} is ready to use."
      echo ""
    else
      success "PgForge installed successfully!"
      echo ""
      info "Next steps:"
      echo ""
      echo "  source $SHELL_CONFIG"
      echo "  pgforge setup"
      echo ""
    fi
  else
    error "Installation failed - binary not found"
  fi
}

main() {
  echo ""
  echo "  ▓▓▓ PgForge Installer"
  echo ""

  detect_platform
  get_latest_version
  install_binary
  setup_path
  start_daemon
  verify_install
}

main

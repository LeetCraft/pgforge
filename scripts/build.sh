#!/bin/bash
set -e

# Build script for PgForge
# Creates binaries for all supported platforms

VERSION=${1:-"2.0.0"}
DIST_DIR="dist"

echo "Building PgForge v${VERSION}..."

# Clean
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build for Linux (x64 and arm64)
platforms=(
  "linux-x64"
  "linux-arm64"
)

for platform in "${platforms[@]}"; do
  os="${platform%-*}"
  arch="${platform#*-}"

  # Map arch names for bun
  bun_arch="$arch"
  if [ "$arch" = "x64" ]; then
    bun_arch="x64"
  fi

  output="$DIST_DIR/pgforge-${platform}"

  echo "  Building for ${os}/${arch}..."
  bun build src/cli.ts --compile --target="bun-${os}-${bun_arch}" --outfile="$output"

  # Make executable
  chmod +x "$output"

  echo "    -> $output"
done

echo ""
echo "Build complete! Binaries in $DIST_DIR/"
ls -la "$DIST_DIR/"

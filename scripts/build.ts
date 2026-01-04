#!/usr/bin/env bun

/**
 * Build script for PgForge releases
 * Creates optimized binaries for distribution
 */

import { VERSION } from "../src/lib/constants";

const TARGETS = [
  { name: "linux-x64", bun: "bun-linux-x64" },
  { name: "linux-arm64", bun: "bun-linux-arm64" },
] as const;

async function build() {
  console.log(`\n🔨 Building PgForge v${VERSION}\n`);

  // Build web panel first
  console.log(`🌐 Building web panel...`);
  const webResult = await Bun.$`bun run scripts/build-web.ts`.quiet().nothrow();
  if (webResult.exitCode !== 0) {
    console.error(`❌ Web panel build failed`);
    console.error(webResult.stderr.toString());
    process.exit(1);
  }
  console.log(`✅ Web panel built`);

  // Create dist directory
  await Bun.$`mkdir -p dist`.quiet();

  // Linux only (x64 or arm64)
  const arch = process.arch;
  const currentTarget = arch === "arm64" ? "linux-arm64" : "linux-x64";

  console.log(`📦 Current platform: ${currentTarget}`);

  // Build for current platform
  console.log(`\n🔧 Building for ${currentTarget}...`);
  const outfile = `dist/pgforge-${currentTarget}`;
  const result = await Bun.$`bun build --compile src/cli.ts --outfile ${outfile}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    console.error(`❌ Build failed for ${currentTarget}`);
    console.error(result.stderr.toString());
    process.exit(1);
  }

  console.log(`✅ Built: ${outfile}`);

  // Get file size
  const file = Bun.file(outfile);
  const size = await file.size;
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  console.log(`   Size: ${sizeMB} MB`);

  // Copy to main binary location
  await Bun.$`cp ${outfile} dist/pgforge`.quiet();
  console.log(`✅ Copied to: dist/pgforge`);

  // Create checksum
  const checksum = await Bun.$`shasum -a 256 ${outfile}`.quiet();
  await Bun.write(`${outfile}.sha256`, checksum.text());
  console.log(`✅ Checksum: ${outfile}.sha256`);

  console.log(`\n🎉 Build complete!`);
  console.log(`\nTo install locally:`);
  console.log(`  cp dist/pgforge ~/.pgforge/bin/pgforge`);
  console.log(`  chmod +x ~/.pgforge/bin/pgforge`);
}

// Run build
build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});

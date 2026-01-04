#!/usr/bin/env bun
/**
 * Build script for the web panel
 * Compiles React app and embeds it into panel.ts
 */

import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const WEB_APP_DIR = join(ROOT, "src/web/app");
const PANEL_TS = join(ROOT, "src/web/panel.ts");

async function buildWebPanel() {
  console.log("Building web panel...");

  // Build the React app with Bun
  const result = await Bun.build({
    entrypoints: [join(WEB_APP_DIR, "App.tsx")],
    minify: true,
    target: "browser",
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Get the bundled JavaScript
  const jsBundle = await result.outputs[0].text();

  // Read the HTML template
  const htmlTemplate = await Bun.file(join(WEB_APP_DIR, "index.html")).text();

  // Replace the script tag with the inline bundle
  const finalHtml = htmlTemplate.replace(
    /<script type="module" src="\.\/App\.tsx"><\/script>/,
    `<script>${jsBundle}</script>`
  );

  // Escape backticks and dollar signs for template literal
  const escapedHtml = finalHtml
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  // Write the panel.ts file
  const panelTs = `// AUTO-GENERATED - DO NOT EDIT
// Run 'bun run build:web' to regenerate
export const PANEL_HTML = \`${escapedHtml}\`;
`;

  await Bun.write(PANEL_TS, panelTs);
  console.log("Web panel built successfully!");
}

buildWebPanel();

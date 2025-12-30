import { test, expect, describe } from "bun:test";
import { join } from "path";

describe("Web panel", () => {
  test("panel.html exists and contains required elements", async () => {
    const panelPath = join(import.meta.dir, "../src/web/panel.html");
    const file = Bun.file(panelPath);

    expect(await file.exists()).toBe(true);

    const content = await file.text();

    // Check HTML structure
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("<html");
    expect(content).toContain("</html>");

    // Check title
    expect(content).toContain("EasyPG");

    // Check required UI elements
    expect(content).toContain("createModal");
    expect(content).toContain("authModal");
    expect(content).toContain("databases");

    // Check API endpoints are referenced (uses API_BASE variable)
    expect(content).toContain("API_BASE");
    expect(content).toContain("/auth");
    expect(content).toContain("/databases");

    // Check authentication elements
    expect(content).toContain("password");
    expect(content).toContain("localStorage");
    expect(content).toContain("Bearer");

    // Check database actions
    expect(content).toContain("createDatabase");
    expect(content).toContain("startDatabase");
    expect(content).toContain("stopDatabase");

    // Check styling
    expect(content).toContain("<style>");
    expect(content).toContain("</style>");
  });

  test("panel.html has proper dark theme styling", async () => {
    const panelPath = join(import.meta.dir, "../src/web/panel.html");
    const content = await Bun.file(panelPath).text();

    // Check for dark theme colors
    expect(content).toContain("#0f0f0f"); // Dark background
    expect(content).toContain("#1a1a1a"); // Card background
    expect(content).toContain("#e5e5e5"); // Light text
  });

  test("panel.html has responsive design", async () => {
    const panelPath = join(import.meta.dir, "../src/web/panel.html");
    const content = await Bun.file(panelPath).text();

    expect(content).toContain("viewport");
    expect(content).toContain("max-width");
  });

  test("panel.html has copy to clipboard functionality", async () => {
    const panelPath = join(import.meta.dir, "../src/web/panel.html");
    const content = await Bun.file(panelPath).text();

    expect(content).toContain("clipboard");
    expect(content).toContain("copyUrl");
  });

  test("panel.html has toast notifications", async () => {
    const panelPath = join(import.meta.dir, "../src/web/panel.html");
    const content = await Bun.file(panelPath).text();

    expect(content).toContain("toast");
    expect(content).toContain("showToast");
  });
});

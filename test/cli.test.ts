import { test, expect, describe } from "bun:test";
import { VERSION } from "../src/lib/constants";

describe("CLI commands", () => {
  test("cli --help shows all commands", async () => {
    const result = await Bun.$`bun run src/cli.ts --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("easypg");
    expect(output).toContain("setup");
    expect(output).toContain("create");
    expect(output).toContain("list");
    expect(output).toContain("start");
    expect(output).toContain("stop");
    expect(output).toContain("backup");
    expect(output).toContain("restore");
    expect(output).toContain("inspect");
    expect(output).toContain("connect");
    expect(output).toContain("destroy");
    expect(output).toContain("update");
    expect(output).toContain("web");
  });

  test("cli --version shows version", async () => {
    const result = await Bun.$`bun run src/cli.ts --version`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain(VERSION);
  });

  test("cli create --help shows options", async () => {
    const result = await Bun.$`bun run src/cli.ts create --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("--name");
    expect(output).toContain("--username");
    expect(output).toContain("--password");
    expect(output).toContain("--database");
    expect(output).toContain("--no-pooler");
  });

  test("cli web --help shows subcommands", async () => {
    const result = await Bun.$`bun run src/cli.ts web --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("enable");
    expect(output).toContain("disable");
    expect(output).toContain("status");
  });

  test("cli web enable --help shows port option", async () => {
    const result = await Bun.$`bun run src/cli.ts web enable --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("--port");
  });

  test("cli stop --help shows options", async () => {
    const result = await Bun.$`bun run src/cli.ts stop --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("--name");
    expect(output).toContain("--all");
  });

  test("cli backup --help shows options", async () => {
    const result = await Bun.$`bun run src/cli.ts backup --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("--name");
    expect(output).toContain("--all");
  });

  test("cli restore --help shows options", async () => {
    const result = await Bun.$`bun run src/cli.ts restore --help`.quiet().nothrow();
    const output = result.stdout.toString();

    expect(output).toContain("--name");
    expect(output).toContain("--file");
  });
});

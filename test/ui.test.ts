import { test, expect } from "bun:test";
import {
  formatStatus,
  formatRelativeTime,
  formatBytes,
  createDatabaseTable,
} from "../src/lib/ui";

test("formatStatus returns correct format for running", () => {
  const result = formatStatus("running");
  expect(result).toContain("running");
});

test("formatStatus returns correct format for stopped", () => {
  const result = formatStatus("stopped");
  expect(result).toContain("stopped");
});

test("formatStatus returns correct format for error", () => {
  const result = formatStatus("error");
  expect(result).toContain("error");
});

test("formatStatus handles unknown status", () => {
  const result = formatStatus("unknown-status");
  expect(result).toContain("unknown");
});

test("formatRelativeTime returns 'just now' for recent dates", () => {
  const now = new Date();
  const result = formatRelativeTime(now);
  expect(result).toBe("just now");
});

test("formatRelativeTime returns minutes ago", () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const result = formatRelativeTime(fiveMinutesAgo);
  expect(result).toContain("m ago");
});

test("formatRelativeTime returns hours ago", () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const result = formatRelativeTime(twoHoursAgo);
  expect(result).toContain("h ago");
});

test("formatRelativeTime returns days ago", () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const result = formatRelativeTime(threeDaysAgo);
  expect(result).toContain("d ago");
});

test("formatRelativeTime accepts string dates", () => {
  const result = formatRelativeTime(new Date().toISOString());
  expect(result).toBe("just now");
});

test("formatBytes returns correct format for 0", () => {
  expect(formatBytes(0)).toBe("0 B");
});

test("formatBytes returns correct format for bytes", () => {
  expect(formatBytes(500)).toBe("500 B");
});

test("formatBytes returns correct format for KB", () => {
  const result = formatBytes(1024);
  expect(result).toContain("KB");
});

test("formatBytes returns correct format for MB", () => {
  const result = formatBytes(1024 * 1024);
  expect(result).toContain("MB");
});

test("formatBytes returns correct format for GB", () => {
  const result = formatBytes(1024 * 1024 * 1024);
  expect(result).toContain("GB");
});

test("createDatabaseTable returns a table instance", () => {
  const table = createDatabaseTable();
  expect(table).toBeDefined();
  expect(typeof table.push).toBe("function");
  expect(typeof table.toString).toBe("function");
});

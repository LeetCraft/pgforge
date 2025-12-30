import { test, expect } from "bun:test";
import { getPublicIp } from "../src/lib/network";

test("getPublicIp returns a valid IP address", async () => {
  const ip = await getPublicIp();

  expect(typeof ip).toBe("string");
  expect(ip.length).toBeGreaterThan(0);

  // Should be either a valid IPv4 or a fallback
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const isValidIp = ipv4Regex.test(ip) || ip === "localhost" || ip === "127.0.0.1";

  expect(isValidIp).toBe(true);
});

test("getPublicIp caches the result", async () => {
  const ip1 = await getPublicIp();
  const ip2 = await getPublicIp();

  // Should return the same cached value
  expect(ip1).toBe(ip2);
});

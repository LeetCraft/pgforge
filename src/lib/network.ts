/**
 * Get the public IP address of this machine
 * Tries multiple methods to ensure reliability
 */
export async function getPublicIp(): Promise<string | null> {
  const methods = [
    // Method 1: ipify (most reliable)
    async () => {
      const res = await fetch("https://api.ipify.org?format=text", { signal: AbortSignal.timeout(5000) });
      if (res.ok) return (await res.text()).trim();
      return null;
    },
    // Method 2: icanhazip
    async () => {
      const res = await fetch("https://icanhazip.com", { signal: AbortSignal.timeout(5000) });
      if (res.ok) return (await res.text()).trim();
      return null;
    },
    // Method 3: ifconfig.me
    async () => {
      const res = await fetch("https://ifconfig.me/ip", { signal: AbortSignal.timeout(5000) });
      if (res.ok) return (await res.text()).trim();
      return null;
    },
    // Method 4: Use curl as fallback
    async () => {
      const result = await Bun.$`curl -s --max-time 5 https://api.ipify.org`.quiet().nothrow();
      if (result.exitCode === 0) return result.text().trim();
      return null;
    },
  ];

  for (const method of methods) {
    try {
      const ip = await method();
      if (ip && isValidIp(ip)) {
        return ip;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Validate IP address format
 */
function isValidIp(ip: string): boolean {
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }

  // IPv6 (simplified check)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6Regex.test(ip);
}

/**
 * Get local IP address (for local development)
 */
export async function getLocalIp(): Promise<string> {
  const result = await Bun.$`hostname -I 2>/dev/null || echo "127.0.0.1"`.quiet().nothrow();
  const ips = result.text().trim().split(/\s+/);
  return ips[0] || "127.0.0.1";
}

/**
 * Build a PostgreSQL connection URL
 */
export function buildConnectionUrl(options: {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl?: boolean;
}): string {
  const { host, port, username, password, database, ssl = false } = options;
  const encodedPassword = encodeURIComponent(password);
  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgresql://${username}:${encodedPassword}@${host}:${port}/${database}${sslParam}`;
}

/**
 * Check if a port is accessible from outside
 */
export async function checkPortAccessible(port: number): Promise<boolean> {
  try {
    const result = await Bun.$`nc -z -w 2 localhost ${port}`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import ora, { type Ora } from "ora";
import { VERSION } from "./constants";

// Brand colors
const brand = {
  primary: chalk.hex("#6366F1"), // Indigo
  secondary: chalk.hex("#8B5CF6"), // Purple
  success: chalk.hex("#10B981"), // Emerald
  warning: chalk.hex("#F59E0B"), // Amber
  error: chalk.hex("#EF4444"), // Red
  info: chalk.hex("#3B82F6"), // Blue
  muted: chalk.hex("#6B7280"), // Gray
  highlight: chalk.hex("#F472B6"), // Pink
};

/**
 * Print the PgForge banner
 */
export function printBanner(): void {
  const versionStr = `v${VERSION}`;
  const padding = " ".repeat(Math.max(0, 14 - versionStr.length));
  const banner = `
${brand.primary("┌─────────────────────────────────────┐")}
${brand.primary("│")}  ${brand.secondary("▓▓▓")} ${chalk.bold.white("PgForge")} ${brand.muted(versionStr)}${padding}${brand.primary("│")}
${brand.primary("│")}  ${brand.muted("Serverless PostgreSQL made simple")}  ${brand.primary("│")}
${brand.primary("└─────────────────────────────────────┘")}
`;
  console.log(banner);
}

/**
 * Print a success message
 */
export function success(message: string): void {
  console.log(`${brand.success("✓")} ${message}`);
}

/**
 * Print an error message
 */
export function error(message: string): void {
  console.log(`${brand.error("✗")} ${message}`);
}

/**
 * Print a warning message
 */
export function warning(message: string): void {
  console.log(`${brand.warning("⚠")} ${message}`);
}

/**
 * Print an info message
 */
export function info(message: string): void {
  console.log(`${brand.info("ℹ")} ${message}`);
}

/**
 * Print a muted/subtle message
 */
export function muted(message: string): void {
  console.log(brand.muted(message));
}

/**
 * Create a spinner
 */
export function spinner(text: string): Ora {
  return ora({
    text,
    color: "magenta",
    spinner: "dots",
  });
}

/**
 * Print a connection URL box
 */
export function printConnectionUrl(url: string, label: string = "Connection URL"): void {
  console.log(
    boxen(
      `${brand.muted(label)}\n\n${brand.highlight(url)}`,
      {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: "round",
        borderColor: "magenta",
      }
    )
  );
}

/**
 * Print database credentials
 */
export function printCredentials(credentials: {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  url: string;
}): void {
  const { name, host, port, username, password, database, url } = credentials;

  console.log(
    boxen(
      `${chalk.bold.white("Database:")} ${brand.primary(name)}\n\n` +
      `${brand.muted("Host:")}     ${chalk.white(host)}\n` +
      `${brand.muted("Port:")}     ${chalk.white(port.toString())}\n` +
      `${brand.muted("User:")}     ${chalk.white(username)}\n` +
      `${brand.muted("Password:")} ${chalk.white(password)}\n` +
      `${brand.muted("Database:")} ${chalk.white(database)}\n\n` +
      `${brand.muted("Connection URL:")}\n${brand.highlight(url)}`,
      {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: "round",
        borderColor: "magenta",
        title: "🐘 PostgreSQL",
        titleAlignment: "center",
      }
    )
  );
}

/**
 * Create a styled table for database listing
 */
export function createDatabaseTable(): Table.Table {
  return new Table({
    head: [
      brand.primary("Name"),
      brand.primary("Status"),
      brand.primary("Port"),
      brand.primary("Created"),
    ],
    style: {
      head: [],
      border: ["gray"],
    },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });
}

/**
 * Format database status with color
 */
export function formatStatus(status: string): string {
  switch (status) {
    case "running":
      return brand.success("● running");
    case "stopped":
      return brand.warning("○ stopped");
    case "creating":
      return brand.info("◐ creating");
    case "error":
      return brand.error("✗ error");
    default:
      return brand.muted("? unknown");
  }
}

/**
 * Format a date relative to now
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return d.toLocaleDateString();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Print a section header
 */
export function printSection(title: string): void {
  console.log(`\n${brand.primary("▸")} ${chalk.bold(title)}`);
}

/**
 * Print key-value pairs
 */
export function printKeyValue(key: string, value: string, indent: number = 2): void {
  const padding = " ".repeat(indent);
  console.log(`${padding}${brand.muted(key + ":")} ${chalk.white(value)}`);
}

/**
 * Print a divider line
 */
export function printDivider(): void {
  console.log(brand.muted("─".repeat(50)));
}

/**
 * Print a clean section box with title and key-value pairs (matching screenshot design)
 */
export function printSectionBox(title: string, items: Array<{ label: string; value: string; color?: 'highlight' | 'success' | 'warning' | 'muted' | 'white' }>, icon?: string): void {
  const titleText = icon ? `${icon} ${title}` : title;
  const maxLabelWidth = Math.max(...items.map(item => item.label.length));

  console.log();
  console.log(brand.primary(`┌─ ${titleText}`));
  console.log(brand.primary("│"));

  items.forEach(item => {
    const paddedLabel = item.label.padEnd(maxLabelWidth);
    let valueColor;
    switch (item.color) {
      case 'highlight':
        valueColor = brand.highlight(item.value);
        break;
      case 'success':
        valueColor = brand.success(item.value);
        break;
      case 'warning':
        valueColor = brand.warning(item.value);
        break;
      case 'muted':
        valueColor = brand.muted(item.value);
        break;
      default:
        valueColor = chalk.white(item.value);
    }
    console.log(brand.primary("│ ") + brand.muted(paddedLabel) + "  " + valueColor);
  });

  console.log(brand.primary("│"));
  console.log(brand.primary("└" + "─".repeat(Math.max(titleText.length + 2, 52))));
}

/**
 * Confirm action with user
 */
export async function confirm(message: string): Promise<boolean> {
  const { default: inquirer } = await import("inquirer");
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: false,
    },
  ]);
  return confirmed;
}

/**
 * Select from a list
 */
export async function select<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  const { default: inquirer } = await import("inquirer");
  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message,
      choices,
    },
  ]);
  return selected;
}

export { brand, chalk };

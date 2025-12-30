#!/usr/bin/env bun
/**
 * Daemon runner script for PgForge
 * This script is spawned as a background process to collect metrics
 * and restart databases on boot.
 */

import { runDaemonLoop } from "./lib/daemon";

// Run the daemon loop
runDaemonLoop();

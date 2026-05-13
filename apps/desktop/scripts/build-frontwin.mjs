#!/usr/bin/env node
// Compiles scripts/frontwin.swift -> dist/frontwin (the focus-follow helper).
// macOS-only; no-op (with a notice) on other platforms so cross-platform CI still passes.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "frontwin.swift");
const outDir = resolve(here, "..", "dist");
const output = join(outDir, "frontwin");

if (process.platform !== "darwin") {
  console.log(`[build:frontwin] skipping on platform=${process.platform}`);
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(`[build:frontwin] missing source: ${source}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) {
  console.log(`[build:frontwin] up to date: ${output}`);
  process.exit(0);
}

try {
  await execFileP("swiftc", ["-O", "-o", output, source]);
  console.log(`[build:frontwin] compiled ${output}`);
} catch (error) {
  console.error(`[build:frontwin] swiftc failed: ${error?.stderr ?? error?.message ?? error}`);
  process.exit(1);
}

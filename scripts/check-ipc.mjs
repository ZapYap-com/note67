#!/usr/bin/env node
// IPC parity check between the Rust command registry and the frontend.
//
// 1. Every command the frontend invokes must be registered in
//    tauri::generate_handler![...] (src-tauri/src/lib.rs). A miss is a runtime
//    "command not found", so it always fails.
// 2. Every registered command should be invoked by production frontend code
//    (tests and fixtures don't count). Commands known to be dead are listed with
//    a reason in scripts/ipc-allowlist.json; anything else unreferenced is new
//    dead surface. Report-only unless --strict.
//
// Usage: node scripts/check-ipc.mjs [--strict]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const strict = process.argv.includes("--strict");

const libRs = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const handler = libRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handler) {
  console.error("Could not find tauri::generate_handler![...] in src-tauri/src/lib.rs");
  process.exit(1);
}
const registered = new Set(
  handler[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join(" ")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").pop()),
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isProductionSource = (path) =>
  /\.(ts|tsx)$/.test(path) &&
  !/\.(test|spec)\.tsx?$/.test(path) &&
  !relative(root, path).startsWith(join("src", "test"));

const invoked = new Map(); // command -> first file that invokes it
const invokePattern = /\binvoke(?:<[^>(]*>)?\(\s*"([A-Za-z0-9_]+)"/g;
for (const file of walk(join(root, "src")).filter(isProductionSource)) {
  const source = readFileSync(file, "utf8");
  for (const [, name] of source.matchAll(invokePattern)) {
    if (!invoked.has(name)) invoked.set(name, relative(root, file));
  }
}

const allowlist = JSON.parse(
  readFileSync(join(root, "scripts/ipc-allowlist.json"), "utf8"),
).commands;

const unregistered = [...invoked].filter(([name]) => !registered.has(name));
const unreferenced = [...registered].filter((name) => !invoked.has(name));
const newDead = unreferenced.filter((name) => !(name in allowlist));
const staleAllowlist = Object.keys(allowlist).filter((name) => !registered.has(name));

console.log(
  `IPC: ${registered.size} registered, ${invoked.size} invoked from src/, ` +
    `${Object.keys(allowlist).length} allowlisted as known dead.`,
);

if (unregistered.length) {
  console.log("\nInvoked but not registered (runtime 'command not found'):");
  for (const [name, file] of unregistered) console.log(`  ${name}  (${file})`);
}
if (newDead.length) {
  console.log("\nRegistered but never invoked, and not in the allowlist:");
  for (const name of newDead) console.log(`  ${name}`);
}
if (staleAllowlist.length) {
  console.log("\nAllowlisted but no longer registered (remove from ipc-allowlist.json):");
  for (const name of staleAllowlist) console.log(`  ${name}`);
}

const failed = unregistered.length > 0 || (strict && (newDead.length || staleAllowlist.length));
if (!failed && !newDead.length && !staleAllowlist.length && !unregistered.length) {
  console.log("OK");
}
process.exit(failed ? 1 : 0);

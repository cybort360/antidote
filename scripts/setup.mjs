#!/usr/bin/env node
// ANTIDOTE one-command local setup.
//   npm run setup
// Copies .env.example → .env.local (never overwrites), installs dependencies
// if missing, applies migrations when DATABASE_URL is configured, and prints
// the next steps. Demo mode needs nothing else.
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envExample = join(root, ".env.example");
const envLocal = join(root, ".env.local");

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, ...opts });
  if (result.status !== 0) {
    console.error(`setup: "${command} ${args.join(" ")}" failed (${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n── ANTIDOTE setup ──────────────────────────────\n");

if (!existsSync(envLocal)) {
  copyFileSync(envExample, envLocal);
  console.log("✓ created .env.local from .env.example (demo mode is default)");
} else {
  console.log("✓ .env.local already exists (left untouched)");
}

if (!existsSync(join(root, "node_modules"))) {
  console.log("installing dependencies…");
  run("npm", ["install"]);
} else {
  console.log("✓ dependencies present");
}

const databaseUrl = process.env.DATABASE_URL ?? readEnv(envLocal, "DATABASE_URL");
if (databaseUrl) {
  console.log("DATABASE_URL detected: applying migrations…");
  run("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  console.log("hint: apply roles with: cockroach sql --url \"$DATABASE_URL\" -f db/roles.sql");
} else {
  console.log("no DATABASE_URL: running in credential-free DEMO_MODE");
}

console.log(`
── next steps ─────────────────────────────────
  npm run dev          → http://localhost:3000
  npm test             → unit + integration tests (PG suite needs DATABASE_URL + DEMO_MODE=false)
  npm run check        → typecheck + tests + production build
  node scripts/smoke-demo.mjs   → end-to-end API verification
  node scripts/verify-release.mjs → full release verification matrix
`);
console.log("setup complete.\n");

function readEnv(file, key) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

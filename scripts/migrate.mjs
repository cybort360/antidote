#!/usr/bin/env node
// ANTIDOTE migration runner. Applies db/migrations/*.sql in order, tracking
// applied versions + checksums in schema_migrations. Each file runs in a
// transaction. Requires DATABASE_URL (from .env / .env.local / environment).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "db", "migrations");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(root, ".env"));
loadEnvFile(join(root, ".env.local"));

if (!process.env.DATABASE_URL) {
  console.error("migrate: DATABASE_URL is not set. Copy .env.example to .env.local and configure CockroachDB.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version STRING PRIMARY KEY,
    checksum STRING NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) {
    console.log("migrate: no migration files found");
    return;
  }

  const { rows: appliedRows } = await pool.query(`SELECT version, checksum FROM schema_migrations`);
  const applied = new Map(appliedRows.map((r) => [String(r.version), String(r.checksum)]));

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    if (applied.has(version)) {
      if (applied.get(version) !== checksum) {
        console.error(`migrate: ${file} was applied with a different checksum. Refusing to re-run.`);
        process.exitCode = 1;
        return;
      }
      console.log(`migrate: ${file} skipped (already applied)`);
      continue;
    }

    console.log(`migrate: applying ${file} ...`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`, [version, checksum]);
      await client.query("COMMIT");
      console.log(`migrate: ${file} applied`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`migrate: ${file} FAILED:`);
      console.error(error.message);
      if (error.code) console.error(`migrate: SQLSTATE ${error.code}`);
      if (error.position) {
        const offset = Math.max(0, Number(error.position) - 1);
        const line = sql.slice(0, offset).split("\n").length;
        console.error(`migrate: ${file}:${line}`);
      }
      process.exitCode = 1;
      return;
    } finally {
      client.release();
    }
  }
  console.log("migrate: done");
}

main().finally(() => pool.end());

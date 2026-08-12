#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const file of [".env", ".env.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const baseUrl = (process.env.ANTIDOTE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiKey = process.env.ANTIDOTE_API_KEY;
const required = ["DATABASE_URL", "ANTIDOTE_TENANT_ID", "ANTIDOTE_API_KEYS"];
const missing = required.filter((name) => !process.env[name] || process.env[name] === "[]");
if (!apiKey) missing.push("ANTIDOTE_API_KEY");
if (process.env.DEMO_MODE !== "false") missing.push("DEMO_MODE=false");
if (!process.env.OPENCODE_GO_API_KEY && !(process.env.AWS_REGION && process.env.BEDROCK_MODEL_ID)) missing.push("OPENCODE_GO_API_KEY or Bedrock configuration");
if (missing.length) {
  console.error(`FAIL live configuration: ${missing.join(", ")}`);
  process.exit(1);
}

let failures = 0;
function result(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) failures += 1;
}

try {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();
  result("health", healthResponse.ok && health.mode === "live", `${healthResponse.status} ${health.mode}`);
  result("cockroach", health.cockroach?.status === "ok", health.cockroach?.status ?? "missing");
  result("vector", health.vectorSearch?.status === "ok", health.vectorSearch?.status ?? "missing");
  const versions = health.migrations?.applied?.map((entry) => entry.version) ?? [];
  result("migrations", health.migrations?.status === "ok" && versions.includes("0006_reevaluation_execution"), versions.join(", ") || "none");
  result("auth-health", health.auth?.status === "configured", health.auth?.status ?? "missing");
  result("model", health.reasoning?.status === "configured", health.reasoning?.provider ?? "missing");

  const denied = await fetch(`${baseUrl}/api/memories`);
  result("missing-key-denied", denied.status === 401, String(denied.status));
  const accepted = await fetch(`${baseUrl}/api/memories`, { headers: { authorization: `Bearer ${apiKey}` } });
  result("tenant-key-accepted", accepted.ok, String(accepted.status));
  const demo = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: "{}" });
  result("demo-disabled", demo.status === 404, String(demo.status));
} catch (error) {
  result("api", false, error.message);
}

if (failures === 0 && process.env.SKIP_LIVE_DB_TESTS !== "true") {
  const integration = spawnSync("npx", ["vitest", "run", "tests/postgres.integration.test.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DEMO_MODE: "false" },
    stdio: "inherit",
  });
  result("cockroach-integration", integration.status === 0, `exit ${integration.status ?? 1}`);
}

process.exit(failures ? 1 : 0);

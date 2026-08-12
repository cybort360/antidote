import { existsSync, readFileSync } from "node:fs";

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
const checks = [];

checks.push({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version });
checks.push({ name: "environment", ok: existsSync(".env.local") || existsSync(".env"), detail: "local environment file" });
try {
  const response = await fetch(`${baseUrl}/api/health`, { headers: process.env.ANTIDOTE_API_KEY ? { authorization: `Bearer ${process.env.ANTIDOTE_API_KEY}` } : {} });
  const health = await response.json();
  checks.push({ name: "api", ok: response.ok, detail: `${response.status} ${health.mode ?? "unknown"}` });
  if (health.mode === "live") {
    checks.push({ name: "cockroach", ok: health.cockroach?.status === "ok", detail: health.cockroach?.status });
    checks.push({ name: "migrations", ok: health.migrations?.status === "ok", detail: health.migrations?.status });
    checks.push({ name: "vector", ok: health.vectorSearch?.status === "ok", detail: health.vectorSearch?.status });
    checks.push({ name: "authentication", ok: health.auth?.status === "configured", detail: health.auth?.status });
    checks.push({ name: "reasoning", ok: health.reasoning?.status === "configured", detail: health.reasoning?.provider });
  }
} catch (error) {
  checks.push({ name: "api", ok: false, detail: error.message });
}

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
if (checks.some((check) => !check.ok && check.name !== "environment")) process.exitCode = 1;

#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const corpusUrl = new URL("../tests/fixtures/screening-corpus.json", import.meta.url);
const corpus = JSON.parse(await readFile(corpusUrl, "utf8"));

async function jsonRequest(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

await jsonRequest("/api/demo/reset", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ seeded: true }),
});
await jsonRequest("/api/demo/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repair: true, fresh: true, deterministic: true }),
});

const rows = [];
for (const item of corpus) {
  const result = await jsonRequest("/api/security/screen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: item.text, sourceUri: item.sourceUri, label: item.id }),
  });
  const predicted = result.blocked ? "blocked" : "trusted";
  rows.push({
    id: item.id,
    expected: item.expected,
    predicted,
    riskScore: result.candidate?.riskScore ?? null,
    factors: result.candidate?.evidence?.map((entry) => entry.factor) ?? [],
  });
}

const tp = rows.filter((row) => row.expected === "blocked" && row.predicted === "blocked").length;
const tn = rows.filter((row) => row.expected === "trusted" && row.predicted === "trusted").length;
const fp = rows.filter((row) => row.expected === "trusted" && row.predicted === "blocked").length;
const fn = rows.filter((row) => row.expected === "blocked" && row.predicted === "trusted").length;
const ratio = (top, bottom) => bottom === 0 ? 0 : top / bottom;
const metrics = {
  corpusSize: rows.length,
  truePositives: tp,
  trueNegatives: tn,
  falsePositives: fp,
  falseNegatives: fn,
  precision: ratio(tp, tp + fp),
  recall: ratio(tp, tp + fn),
  specificity: ratio(tn, tn + fp),
  accuracy: ratio(tp + tn, rows.length),
};

for (const row of rows) {
  const pass = row.expected === row.predicted;
  console.log(`${pass ? "PASS" : "MISS"} ${row.id.padEnd(10)} expected=${row.expected.padEnd(7)} predicted=${row.predicted.padEnd(7)} risk=${String(row.riskScore).padEnd(5)} factors=${row.factors.join("+") || "none"}`);
}
console.log(`\n${JSON.stringify(metrics, null, 2)}`);

if (process.env.SCREENING_REPORT_PATH) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(process.env.SCREENING_REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, metrics, rows }, null, 2)}\n`, "utf8");
}

const minimumPrecision = Number(process.env.MIN_SCREENING_PRECISION ?? 0.8);
const minimumRecall = Number(process.env.MIN_SCREENING_RECALL ?? 0.8);
if (metrics.precision < minimumPrecision || metrics.recall < minimumRecall) {
  console.error(`Screening quality gate failed. Required precision >= ${minimumPrecision} and recall >= ${minimumRecall}.`);
  process.exit(1);
}

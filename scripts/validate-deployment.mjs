#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const templatePath = new URL("../aws/template.yaml", import.meta.url);
const workerPath = new URL("../aws/repair-worker.ts", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const [template, worker, packageText] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(workerPath, "utf8"),
  readFile(packagePath, "utf8"),
]);
const packageJson = JSON.parse(packageText);

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

const requiredTemplateTokens = [
  "Transform: AWS::Serverless-2016-10-31",
  "ObjectLockEnabled: true",
  "Mode: COMPLIANCE",
  "DeletionPolicy: Retain",
  "UpdateReplacePolicy: Retain",
  "Runtime: nodejs22.x",
  "FunctionResponseTypes:",
  "- ReportBatchItemFailures",
  "aws:SourceAccount: !Ref AWS::AccountId",
  "DATABASE_URL: !Sub \"{{resolve:ssm:${DatabaseUrlParameter}}}\"",
  "ANTIDOTE_API_KEYS: !Sub \"{{resolve:ssm:${ApiKeysParameter}}}\"",
  "EVIDENCE_SIGNING_SECRET: !Sub \"{{resolve:ssm:${EvidenceSigningSecretParameter}}}\"",
  "s3:PutObject",
];
for (const token of requiredTemplateTokens) {
  check(`template:${token.split(":")[0]}`, template.includes(token), token);
}

const resourcesSection = template.slice(template.indexOf("Resources:"), template.indexOf("Outputs:"));
const resourceNames = [...resourcesSection.matchAll(/^  ([A-Za-z][A-Za-z0-9]+):\s*$/gm)].map((match) => match[1]);
const duplicates = resourceNames.filter((name, index) => resourceNames.indexOf(name) !== index);
check("template:unique-resources", duplicates.length === 0, duplicates.length ? duplicates.join(", ") : `${resourceNames.length} unique resources and outputs`);

const plainSecretPatterns = [
  /^\s+(?:DATABASE_URL|ANTIDOTE_API_KEYS|OPENCODE_GO_API_KEY):\s+(?!\!Sub|\!Ref|\{\{resolve:)[^\s]/m,
  /(?:postgres(?:ql)?:\/\/)[^\s"']+/i,
  /(?:sk-|opencode-)[A-Za-z0-9_-]{12,}/,
];
check("template:no-plain-secrets", !plainSecretPatterns.some((pattern) => pattern.test(template)), "runtime secrets use SSM dynamic references");
check("template:scoped-bedrock", !/Sid: InvokeBedrock[\s\S]{0,180}Resource:\s+[^\n]*foundation-model\/\*/.test(template), "Bedrock access names the configured and embedding models");
check("worker:handler", /export async function handler\(/.test(worker), "exported Lambda entrypoint");
check("worker:partial-batch", /batchItemFailures/.test(worker), "SQS partial batch response present");
check("worker:retry", /withRetry/.test(worker), "repair and evidence operations use bounded retries");
check("package:esbuild", Boolean(packageJson.devDependencies?.esbuild), packageJson.devDependencies?.esbuild ?? "missing");

try {
  await access(new URL("../node_modules/.bin/esbuild", import.meta.url));
  check("package:esbuild-binary", true, "installed");
} catch {
  check("package:esbuild-binary", false, "run npm install");
}

const failed = checks.filter((entry) => !entry.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} deployment checks passed.`);
if (failed.length) process.exit(1);

import { createHash, randomBytes } from "node:crypto";

const provided = process.argv[2];
const key = provided || `ant_${randomBytes(32).toString("base64url")}`;
const keyHash = createHash("sha256").update(key).digest("hex");

process.stdout.write(JSON.stringify({
  apiKey: provided ? undefined : key,
  keyHash,
  credentialTemplate: { keyHash, tenantId: "tenant_replace_me", principal: "agent_replace_me", role: "writer" },
}, null, 2));
process.stdout.write("\n");

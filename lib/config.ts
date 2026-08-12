import { z } from "zod";

const EnvSchema = z.object({
  DEMO_MODE: z.string().optional().default("true"),
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).optional().default(10),
  DB_POOL_MIN: z.coerce.number().int().min(0).max(50).optional().default(1),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).optional().default(30_000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).optional().default(10_000),
  DB_SSL: z.enum(["auto", "true", "false"]).optional().default("auto"),
  DB_CA_CERT: z.string().optional(),
  ANTIDOTE_TENANT_ID: z.string().trim().min(1).optional(),
  ANTIDOTE_API_KEYS: z.string().optional(),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10000).optional().default(600),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().optional(),
  BEDROCK_EMBED_MODEL_ID: z.string().optional().default("amazon.titan-embed-text-v2:0"),
  EMBEDDING_PROVIDER: z.enum(["local", "bedrock"]).optional().default("local"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(1024).optional().default(1024),
  SCREENING_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.45),
  EVIDENCE_BUCKET: z.string().optional(),
  EVIDENCE_SIGNING_SECRET: z.string().min(32).optional(),
  COCKROACH_MCP_URL: z.string().optional(),
  COCKROACH_MCP_API_KEY: z.string().optional(),
  OPENCODE_GO_API_KEY: z.string().optional(),
  OPENCODE_GO_MODEL: z.string().optional().default("deepseek-v4-flash"),
  OPENCODE_GO_BASE_URL: z.string().url().optional().default("https://opencode.ai/zen/go/v1"),
  REEVALUATION_CALLBACK_URL: z.string().url().optional(),
  REEVALUATION_CALLBACK_SECRET: z.string().min(32).optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function env(): AppEnv {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}

export function isDemo(): boolean {
  return env().DEMO_MODE !== "false";
}

export function hasDatabase(): boolean {
  return Boolean(env().DATABASE_URL);
}

export function hasBedrock(): boolean {
  return Boolean(env().AWS_REGION && env().BEDROCK_MODEL_ID);
}

export function hasOpenCodeGo(): boolean {
  return Boolean(env().OPENCODE_GO_API_KEY);
}

export function embeddingDimensions(): number {
  return env().EMBEDDING_DIMENSIONS;
}

export function embedModelId(): string {
  return env().BEDROCK_EMBED_MODEL_ID;
}

export function useBedrockEmbeddings(): boolean {
  return env().EMBEDDING_PROVIDER === "bedrock";
}

export function chunkSize(): number {
  return 2000;
}

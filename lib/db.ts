import { Pool } from "pg";
import type { PoolConfig } from "pg";
import { env } from "./config";

let pool: Pool | undefined;

export function sslFromUrl(url: string): PoolConfig["ssl"] {
  let sslMode = "disable";
  try {
    sslMode = new URL(url).searchParams.get("sslmode") ?? "disable";
  } catch {
    // fall through to env override
  }
  const configured = env().DB_SSL;
  const ca = env().DB_CA_CERT?.replace(/\\n/g, "\n");
  if (configured === "true") return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  if (configured === "false") return undefined;
  return sslMode === "verify-full" || sslMode === "verify-ca" || sslMode === "require"
    ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
    : undefined;
}

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: env().DB_POOL_MAX,
      min: env().DB_POOL_MIN,
      idleTimeoutMillis: env().DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env().DB_CONNECTION_TIMEOUT_MS,
      maxUses: 100_000,
      ssl: sslFromUrl(process.env.DATABASE_URL),
      application_name: "antidote",
    });
    pool.on("error", (error) => {
      console.error("[antidote:db] idle client error", error.message);
    });
  }
  return pool;
}

export async function pingDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await db().query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export function poolStats(): { total: number; idle: number; waiting: number } {
  if (!pool) return { total: 0, idle: 0, waiting: 0 };
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export type TransactionOptions = {
  isolation?: "read committed" | "serializable";
  retries?: number;
};

// CockroachDB surfaces serialization conflicts (40001) and indeterminate
// commits (40003) as retryable errors; retry the whole transaction body.
const RETRYABLE_CODES = new Set(["40001", "40003", "CR000"]);

export function isRetryablePgError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && RETRYABLE_CODES.has(String((error as { code?: string }).code));
}

export async function withTransaction<T>(
  fn: (query: QueryFn) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await db().connect();
  const retries = options.retries ?? 4;
  let attempt = 0;
  try {
    for (;;) {
      attempt += 1;
      try {
        await client.query("BEGIN");
        if (options.isolation) await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation.toUpperCase()}`);
        const result = await fn((text, values) => client.query(text, values));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        if (isRetryablePgError(error) && attempt <= retries) {
          continue;
        }
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { env, hasBedrock, hasDatabase, hasOpenCodeGo, isDemo } from "@/lib/config";
import { toErrorBody } from "@/lib/errors";

type HealthBody = {
  ok: boolean;
  mode: string;
  demo: boolean;
  cockroach: { status: "ok" | "unconfigured" | "error"; latencyMs?: number; error?: string };
  vectorSearch: { status: "ok" | "unconfigured" | "error"; error?: string };
  migrations: { status: "ok" | "unconfigured" | "error"; applied: { version: string; appliedAt: string }[] | null; error?: string };
  pool: { total: number; idle: number; waiting: number };
  bedrock: string;
  reasoning: { status: "configured" | "unconfigured"; provider: "bedrock" | "opencode-go" | "fallback" };
  auth: { status: "configured" | "unconfigured"; tenantId?: string };
  mcp: boolean;
};

export async function GET() {
  const body: HealthBody = {
    ok: true,
    mode: isDemo() ? "demo" : "live",
    demo: isDemo(),
    cockroach: { status: "unconfigured" },
    vectorSearch: { status: "unconfigured" },
    migrations: { status: "unconfigured", applied: null },
    pool: { total: 0, idle: 0, waiting: 0 },
    bedrock: hasBedrock() ? "configured" : "unconfigured",
    reasoning: {
      status: hasBedrock() || hasOpenCodeGo() ? "configured" : "unconfigured",
      provider: hasOpenCodeGo() ? "opencode-go" : hasBedrock() ? "bedrock" : "fallback",
    },
    auth: {
      status: env().ANTIDOTE_TENANT_ID && env().ANTIDOTE_API_KEYS && env().ANTIDOTE_API_KEYS !== "[]" ? "configured" : "unconfigured",
      ...(env().ANTIDOTE_TENANT_ID ? { tenantId: env().ANTIDOTE_TENANT_ID } : {}),
    },
    mcp: Boolean(env().COCKROACH_MCP_URL),
  };

  if (!isDemo() && hasDatabase()) {
    try {
      const { pingDb, poolStats } = await import("@/lib/db");
      const ping = await pingDb();
      body.cockroach = ping.ok ? { status: "ok", latencyMs: ping.latencyMs } : { status: "error", latencyMs: ping.latencyMs, error: ping.error };
      body.pool = poolStats();
      if (ping.ok) {
        const { db } = await import("@/lib/db");
        try {
          await db().query(`SELECT '[1,2,3]'::VECTOR`);
          body.vectorSearch = { status: "ok" };
        } catch (error) {
          body.vectorSearch = { status: "error", error: (error as Error).message };
        }
        try {
          const { rows } = await db().query(`SELECT version, applied_at FROM schema_migrations ORDER BY version`);
          body.migrations = { status: "ok", applied: rows.map((r) => ({ version: String(r.version), appliedAt: new Date(r.applied_at as string).toISOString() })) };
        } catch (error) {
          body.migrations = { status: "error", applied: null, error: (error as Error).message };
        }
      }
    } catch (error) {
      body.cockroach = { status: "error", error: (error as Error).message };
    }
  }

  body.ok = body.cockroach.status !== "error" && body.vectorSearch.status !== "error" && body.migrations.status !== "error";
  if (!isDemo()) {
    body.ok = body.ok && body.cockroach.status === "ok" && body.vectorSearch.status === "ok" && body.migrations.status === "ok" && body.auth.status === "configured" && body.reasoning.status === "configured";
  }
  return NextResponse.json(body, { status: body.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
}

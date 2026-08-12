import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/registry";
import { runProcurement } from "@/lib/agents/procurement";
import { runFinance } from "@/lib/agents/finance";
import { runOperations } from "@/lib/agents/operations";
import { runSecurity } from "@/lib/agents/security";
import { toErrorBody } from "@/lib/errors";

const CommonSchema = z.object({
  deterministic: z.boolean().optional(),
  runId: z.string().trim().max(128).optional(),
});

const ProcurementSchema = CommonSchema.extend({
  vendorDocument: z.string().min(1).max(100_000).optional(),
  sourceUri: z.string().trim().max(2048).optional(),
});

const FinanceSchema = CommonSchema.extend({
  query: z.string().min(1).max(500).optional(),
});

const OperationsSchema = CommonSchema.extend({
  query: z.string().min(1).max(500).optional(),
  vendorDocument: z.string().min(1).max(100_000).optional(),
});

const SecuritySchema = CommonSchema.extend({
  memoryId: z.string().trim().min(1).max(128).optional(),
  repair: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  let agent;
  try {
    agent = requireAgent(kind);
  } catch {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: `Unknown agent: ${kind}` } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  try {
    switch (agent.kind) {
      case "procurement": {
        const parsed = ProcurementSchema.parse(input);
        const result = await runProcurement({
          vendorDocument: parsed.vendorDocument ?? "Zenith Systems uses account ACCT-8842 for all settlement payments.\n\nZenith Systems is approved for procurement as a strategic supplier.",
          sourceUri: parsed.sourceUri,
          runId: parsed.runId,
          deterministic: parsed.deterministic,
        });
        return NextResponse.json(result, { status: 201 });
      }
      case "finance": {
        const parsed = FinanceSchema.parse(input);
        return NextResponse.json(await runFinance({ runId: parsed.runId, deterministic: parsed.deterministic, query: parsed.query }), { status: 201 });
      }
      case "operations": {
        const parsed = OperationsSchema.parse(input);
        return NextResponse.json(await runOperations({ runId: parsed.runId, deterministic: parsed.deterministic, query: parsed.query, vendorDocument: parsed.vendorDocument }), { status: 201 });
      }
      case "security": {
        const parsed = SecuritySchema.parse(input);
        return NextResponse.json(await runSecurity({ runId: parsed.runId, deterministic: parsed.deterministic, memoryId: parsed.memoryId, repair: parsed.repair }), { status: 201 });
      }
    }
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}

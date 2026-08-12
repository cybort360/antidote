import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runZenithScenario } from "@/lib/agents/runScenario";
import { toErrorBody } from "@/lib/errors";

const RunSchema = z.object({
  repair: z.boolean().optional().default(true),
  fresh: z.boolean().optional().default(true),
  vendorDocument: z.string().min(1).max(100_000).optional(),
  deterministic: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = RunSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const run = await runZenithScenario(parsed.data);
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}

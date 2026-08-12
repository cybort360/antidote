import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAttackReplay } from "@/lib/agents/attackReplay";
import { toErrorBody } from "@/lib/errors";

const ReplaySchema = z.object({
  fresh: z.boolean().optional().default(false),
  document: z.string().min(1).max(100_000).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = ReplaySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const result = await runAttackReplay(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}

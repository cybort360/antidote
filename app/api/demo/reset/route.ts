import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetStore } from "@/lib/store";
import { getStore } from "@/lib/store";
import { isDemo } from "@/lib/config";
import { toErrorBody } from "@/lib/errors";

const ResetSchema = z.object({
  seeded: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  if (!isDemo()) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Reset is only available in demo mode" } }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = ResetSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request" } }, { status: 400 });
  }
  try {
    resetStore(parsed.data.seeded);
    const scenario = await getStore().getScenario();
    return NextResponse.json({ reset: true, seeded: parsed.data.seeded, scenario });
  } catch (error) {
    const bodyErr = toErrorBody(error);
    return NextResponse.json(bodyErr.error, { status: bodyErr.status });
  }
}

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";

export async function GET() {
  try {
    const scenario = await getStore().getScenario();
    return NextResponse.json(scenario, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}

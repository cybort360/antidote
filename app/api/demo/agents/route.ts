import { NextResponse } from "next/server";
import { AGENT_REGISTRY } from "@/lib/agents/registry";

export async function GET() {
  return NextResponse.json({
    agents: AGENT_REGISTRY.map((a) => ({ id: a.id, kind: a.kind, label: a.label, role: a.role })),
  });
}

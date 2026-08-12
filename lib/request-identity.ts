import type { NextRequest } from "next/server";

export function authenticatedPrincipal(request: NextRequest): string | undefined {
  return request.headers.get("x-antidote-principal") ?? undefined;
}

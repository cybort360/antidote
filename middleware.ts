import { NextRequest, NextResponse } from "next/server";

export type ApiRole = "reader" | "writer" | "forensics" | "admin";
export type ApiCredential = {
  keyHash: string;
  tenantId: string;
  principal: string;
  role: ApiRole;
};

const windows = new Map<string, { startedAt: number; count: number }>();

function error(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json(
    { error: { code, message }, requestId },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export function parseCredentials(): ApiCredential[] {
  const raw = process.env.ANTIDOTE_API_KEYS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ANTIDOTE_API_KEYS must be a JSON array");
  return parsed.map((entry) => {
    const value = entry as Partial<ApiCredential>;
    if (!value.keyHash?.match(/^[a-f0-9]{64}$/i) || !value.tenantId || !value.principal || !["reader", "writer", "forensics", "admin"].includes(String(value.role))) {
      throw new Error("ANTIDOTE_API_KEYS contains an invalid credential record");
    }
    return value as ApiCredential;
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

export function permits(role: ApiRole, request: NextRequest): boolean {
  if (role === "admin") return true;
  if (request.method === "GET") return true;
  if (request.nextUrl.pathname.startsWith("/api/agents/")) return false;
  if (request.nextUrl.pathname === "/api/trace") return role === "forensics";
  if (request.nextUrl.pathname.startsWith("/api/security/")) return role === "forensics";
  if (request.nextUrl.pathname === "/api/revocations") return false;
  return role === "writer";
}

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const live = process.env.DEMO_MODE === "false";
  if (!live || request.nextUrl.pathname === "/api/health") {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  }

  if (request.nextUrl.pathname.startsWith("/api/demo/")) return error(404, "NOT_FOUND", "Demo routes are disabled in live mode", requestId);

  const tenantId = process.env.ANTIDOTE_TENANT_ID;
  let credentials: ApiCredential[];
  try {
    credentials = parseCredentials();
  } catch {
    return error(503, "AUTH_CONFIGURATION_INVALID", "API authentication is not configured safely", requestId);
  }
  if (!tenantId || credentials.length === 0 || credentials.some((credential) => credential.tenantId !== tenantId)) {
    return error(503, "AUTH_CONFIGURATION_INVALID", "Live mode requires one tenant-scoped API key set", requestId);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return error(401, "UNAUTHORIZED", "A bearer API key is required", requestId);
  const tokenHash = await sha256(token);
  const credential = credentials.find((candidate) => equalHex(candidate.keyHash.toLowerCase(), tokenHash));
  if (!credential) return error(401, "UNAUTHORIZED", "The bearer API key is invalid", requestId);
  if (!permits(credential.role, request)) return error(403, "FORBIDDEN", "The API key does not permit this operation", requestId);

  const rateLimit = Math.max(10, Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 600));
  const now = Date.now();
  const rateKey = `${credential.tenantId}:${credential.keyHash}`;
  const current = windows.get(rateKey);
  const windowState = !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 1 } : { ...current, count: current.count + 1 };
  windows.set(rateKey, windowState);
  if (windowState.count > rateLimit) return error(429, "RATE_LIMITED", "API rate limit exceeded", requestId);

  const headers = new Headers(request.headers);
  headers.delete("x-antidote-tenant-id");
  headers.delete("x-antidote-principal");
  headers.delete("x-antidote-role");
  headers.set("x-antidote-tenant-id", credential.tenantId);
  headers.set("x-antidote-principal", credential.principal);
  headers.set("x-antidote-role", credential.role);
  headers.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-ratelimit-limit", String(rateLimit));
  response.headers.set("x-ratelimit-remaining", String(Math.max(0, rateLimit - windowState.count)));
  return response;
}

export const config = { matcher: ["/api/:path*"] };

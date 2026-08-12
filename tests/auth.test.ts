import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { middleware, parseCredentials, permits } from "../middleware";

const original = {
  DEMO_MODE: process.env.DEMO_MODE,
  ANTIDOTE_TENANT_ID: process.env.ANTIDOTE_TENANT_ID,
  ANTIDOTE_API_KEYS: process.env.ANTIDOTE_API_KEYS,
  API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE,
};

const rawKey = "ant_test_only_key_123456789";
const keyHash = createHash("sha256").update(rawKey).digest("hex");

function request(path: string, method = "GET", key?: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
  });
}

describe("live API authentication", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "false";
    process.env.ANTIDOTE_TENANT_ID = "tenant-test";
    process.env.API_RATE_LIMIT_PER_MINUTE = "600";
    process.env.ANTIDOTE_API_KEYS = JSON.stringify([
      { keyHash, tenantId: "tenant-test", principal: "test-reader", role: "reader" },
    ]);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects missing and invalid bearer keys", async () => {
    expect((await middleware(request("/api/memories"))).status).toBe(401);
    expect((await middleware(request("/api/memories", "GET", "wrong"))).status).toBe(401);
  });

  it("accepts a reader for GET and replaces spoofed identity headers", async () => {
    const response = await middleware(request("/api/memories", "GET", rawKey, { "x-antidote-tenant-id": "attacker" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-antidote-tenant-id")).toBe("tenant-test");
    expect(response.headers.get("x-middleware-request-x-antidote-principal")).toBe("test-reader");
  });

  it("blocks reader mutations and reserves agent execution for admins", async () => {
    expect((await middleware(request("/api/decisions", "POST", rawKey))).status).toBe(403);
    expect(permits("writer", request("/api/agents/security/run", "POST"))).toBe(false);
    expect(permits("admin", request("/api/agents/security/run", "POST"))).toBe(true);
  });

  it("fails closed when credentials belong to a different tenant", async () => {
    process.env.ANTIDOTE_API_KEYS = JSON.stringify([
      { keyHash, tenantId: "another-tenant", principal: "test-reader", role: "reader" },
    ]);
    expect((await middleware(request("/api/memories", "GET", rawKey))).status).toBe(503);
  });

  it("validates credential records", () => {
    expect(parseCredentials()).toHaveLength(1);
    process.env.ANTIDOTE_API_KEYS = "[]";
    expect(parseCredentials()).toEqual([]);
    process.env.ANTIDOTE_API_KEYS = '[{"keyHash":"bad"}]';
    expect(() => parseCredentials()).toThrow("invalid credential record");
  });
});

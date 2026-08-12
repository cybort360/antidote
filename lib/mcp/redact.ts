/**
 * Deep redaction for forensic evidence. Guarantees that MCP operation params,
 * results, and audit logs never carry secrets (connection strings, API keys,
 * bearer tokens, AWS credentials).
 */

const SENSITIVE_KEY = /(password|passwd|secret|api[_-]?key|token|bearer|authorization|credential|cookie|private[_-]?key|access[_-]?key|session|signature|ssl[_-]?cert)/i;

const SENSITIVE_VALUE = /(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|postgres(ql)?:\/\/[^\s"']+|s3:\/\/[^\s"']*:[^\s"']*@|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const REDACTED = "[REDACTED]";

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function isSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE.test(value);
}

export function redactValue(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (isSensitiveKey(key) || isSensitiveValue(value)) return REDACTED;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return String(value);
}

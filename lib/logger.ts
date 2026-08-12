export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function effectiveLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return configured in LEVEL_ORDER ? (configured as LogLevel) : "info";
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[effectiveLevel()]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  // Structured JSON lines for CloudWatch / log ingestion; never logs secrets.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};

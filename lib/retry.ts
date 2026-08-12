import { logger } from "./logger";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
};

function defaultRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; statusCode?: number; code?: string };
  if (e.statusCode === 429 || (e.statusCode ?? 0) >= 500) return true;
  if (typeof e.code === "string" && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EPIPE", "TimeoutError", "AbortError"].includes(e.code)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const retryable = options.retryable ?? defaultRetryable;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) throw error;
      const jitter = Math.random() * 100;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);
      logger.warn("retry.scheduled", { attempt, attempts, delayMs: Math.round(delay), error: (error as Error)?.message });
      await sleep(delay);
    }
  }
  throw lastError;
}

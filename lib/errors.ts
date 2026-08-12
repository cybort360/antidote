import { ZodError } from "zod";

export class AntidoteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AntidoteError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message: string, details?: unknown): AntidoteError {
  return new AntidoteError(404, "NOT_FOUND", message, details);
}

export function badRequest(message: string, details?: unknown): AntidoteError {
  return new AntidoteError(400, "BAD_REQUEST", message, details);
}

export function conflict(message: string, details?: unknown): AntidoteError {
  return new AntidoteError(409, "CONFLICT", message, details);
}

export function upstream(message: string, details?: unknown): AntidoteError {
  return new AntidoteError(502, "UPSTREAM_ERROR", message, details);
}

export function internal(message: string, details?: unknown): AntidoteError {
  return new AntidoteError(500, "INTERNAL", message, details);
}

export function toErrorBody(error: unknown): { error: { code: string; message: string; details?: unknown }; status: number } {
  if (error instanceof AntidoteError) {
    return { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) }, status: error.status };
  }
  if (error instanceof ZodError) {
    return { error: { code: "BAD_REQUEST", message: "Invalid request", details: error.flatten() }, status: 400 };
  }
  if (error instanceof Error) {
    return { error: { code: "INTERNAL", message: error.message }, status: 500 };
  }
  return { error: { code: "INTERNAL", message: "Unknown error" }, status: 500 };
}

export function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

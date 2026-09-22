/**
 * Typed errors so the MCP layer can map a failure to the correct JSON-RPC
 * error code without pattern-matching on message strings.
 */
export type SightlineErrorCode =
  | "invalid_input"
  | "not_found"
  | "unsupported_media"
  | "too_large"
  | "backend_unavailable"
  | "internal";

export class SightlineError extends Error {
  readonly code: SightlineErrorCode;
  readonly hint?: string;

  constructor(code: SightlineErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "SightlineError";
    this.code = code;
    this.hint = hint;
  }
}

export function isSightlineError(error: unknown): error is SightlineError {
  return error instanceof SightlineError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

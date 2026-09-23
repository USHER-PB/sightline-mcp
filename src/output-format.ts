/**
 * Optional structured (JSON) responses.
 *
 * Models are chatty, so the raw text is parsed leniently: outright JSON, a
 * fenced code block, or JSON embedded in prose are all accepted. When nothing
 * parses the caller keeps the raw text instead of losing the answer.
 */
export type OutputFormat = "text" | "json";

export interface JsonParseSuccess {
  ok: true;
  value: unknown;
}

export interface JsonParseFailure {
  ok: false;
  error: string;
}

export type JsonParseResult = JsonParseSuccess | JsonParseFailure;

export const JSON_INSTRUCTION =
  "Respond with a single valid JSON value only - no markdown code fences and no text before or after it.";

export function isOutputFormat(value: unknown): value is OutputFormat {
  return value === "text" || value === "json";
}

/**
 * Append the JSON instruction to a prompt (idempotently).
 */
export function withJsonInstruction(prompt: string): string {
  return prompt.includes(JSON_INSTRUCTION) ? prompt : `${prompt} ${JSON_INSTRUCTION}`;
}

/**
 * Strip a ```json ... ``` fence if the model wrapped its answer in one.
 */
export function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json|jsonc)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced ? fenced[1].trim() : text;
}

/**
 * Extract the first balanced JSON object/array found in a string.
 */
export function extractJsonSubstring(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === opening) depth++;
    else if (char === closing) {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * Parse a model response as JSON, tolerating fences and surrounding prose.
 */
export function parseJsonResponse(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "the model returned an empty response" };

  const candidates = [trimmed, stripCodeFence(trimmed), extractJsonSubstring(stripCodeFence(trimmed))];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Try the next, more permissive candidate.
    }
  }

  return { ok: false, error: "the response was not valid JSON" };
}

/**
 * MCP `structuredContent` must be an object, so arrays and primitives are
 * wrapped instead of rejected.
 */
export function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (Array.isArray(value)) return { results: value };
  return { result: value };
}

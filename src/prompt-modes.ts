import { SightlineError } from "./errors.js";

export type PromptMode = "general" | "ocr" | "ui-layout" | "error" | "diagram";

export interface PromptModeConfig {
  name: string;
  description: string;
  prompt: string;
}

export const DEFAULT_PROMPT_MODE: PromptMode = "general";

export const PROMPT_MODES: Record<PromptMode, PromptModeConfig> = {
  general: {
    name: "General",
    description: "balanced description of the image content",
    prompt:
      "Describe what you see in this image, including any visible text, UI elements, or relevant details.",
  },
  ocr: {
    name: "OCR / Text Extraction",
    description: "extract all visible text verbatim",
    prompt:
      "Extract ALL visible text from this image verbatim. Preserve the exact wording, punctuation, and formatting. Do not describe or interpret - just transcribe the text exactly as it appears. If there are multiple text elements, list them in reading order (top to bottom, left to right).",
  },
  "ui-layout": {
    name: "UI Layout",
    description: "focus on UI structure, elements, and hierarchy",
    prompt:
      "Analyze the UI layout and structure of this image. Describe: 1) The overall layout and sections, 2) All UI elements (buttons, inputs, menus, etc.) with their labels, 3) The visual hierarchy and flow, 4) Any notable design patterns or components. Focus on the interface structure, not content.",
  },
  error: {
    name: "Error Detection",
    description: "identify and explain errors, warnings, or issues",
    prompt:
      "Analyze this image for errors, warnings, or issues. Identify: 1) Any error messages, stack traces, or warning indicators, 2) The type of error (syntax, runtime, network, etc.), 3) Key details like file names, line numbers, error codes, 4) Suggested causes if apparent. Focus on diagnostic information.",
  },
  diagram: {
    name: "Diagram / Architecture",
    description: "explain diagrams, flowcharts, or architecture",
    prompt:
      "Analyze this diagram or visual representation. Describe: 1) The type of diagram (flowchart, architecture, UML, etc.), 2) All components, nodes, or elements and their labels, 3) Connections, relationships, or flows between elements, 4) The overall purpose or what the diagram represents. Be precise about the structure and relationships shown.",
  },
};

/** All mode names, in a stable order, for use in tool schemas. */
export const PROMPT_MODE_NAMES: PromptMode[] = Object.keys(PROMPT_MODES) as PromptMode[];

export function isPromptMode(value: unknown): value is PromptMode {
  return typeof value === "string" && (PROMPT_MODE_NAMES as string[]).includes(value);
}

/**
 * Validate a mode coming from a tool call. Missing values fall back to
 * `general`; unknown values are rejected with a useful message instead of
 * crashing deeper in the stack.
 */
export function parsePromptMode(value: unknown): PromptMode {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PROMPT_MODE;
  }

  if (!isPromptMode(value)) {
    throw new SightlineError(
      "invalid_input",
      `Unknown mode "${String(value)}".`,
      `Valid modes: ${PROMPT_MODE_NAMES.join(", ")}.`
    );
  }

  return value;
}

/**
 * Resolve the prompt for a mode. A non-blank custom prompt replaces the mode's
 * preset prompt entirely.
 */
export function getPromptForMode(mode: PromptMode, customPrompt?: string): string {
  const trimmed = customPrompt?.trim();
  if (trimmed) return trimmed;
  return PROMPT_MODES[mode].prompt;
}

/** Single-line summary of every mode, used to build tool descriptions. */
export function describeModes(): string {
  return PROMPT_MODE_NAMES.map((name) => `'${name}': ${PROMPT_MODES[name].description}`).join(", ");
}

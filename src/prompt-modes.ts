import { SightlineError } from "./errors.js";

export type PromptMode = "general" | "ocr" | "ui-layout" | "ui-elements" | "error" | "diagram";

/** Modes that only make sense as structured output. */
export const JSON_PROMPT_MODES: PromptMode[] = ["ui-elements"];

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
  "ui-elements": {
    name: "UI Elements (JSON)",
    description: "locate interactive elements with normalized bounding boxes (JSON)",
    prompt:
      'Locate every interactive or labelled UI element in this image and return JSON only in this shape: {"image":{"width":<pixels>,"height":<pixels>},"elements":[{"label":"<visible text or accessible name>","role":"button|input|link|menu|tab|icon|text|other","box":{"x":<0-1>,"y":<0-1>,"w":<0-1>,"h":<0-1>}}]}. Boxes are normalised to the image size with the origin (0,0) at the top-left corner. Include elements from top to bottom, left to right. Do not add commentary.',
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

/**
 * Default prompt for multi-image comparisons, placed before the comparison
 * target list so the model knows which image is which.
 */
export const COMPARISON_PROMPT =
  "Compare these images and report what is identical, what differs, and which image each statement applies to (refer to them as Image 1, Image 2, and so on). Cover visible text, layout, state, and any change that looks unintentional. Be specific and do not invent details that are not visible.";

/**
 * Resolve the prompt for a multi-image request: the comparison prompt (or the
 * selected mode) plus an explicit list of what each image is.
 */
export function buildComparisonPrompt(
  labels: string[],
  mode: PromptMode,
  customPrompt?: string
): string {
  const base = getPromptForMode(mode, customPrompt || COMPARISON_PROMPT);
  const legend = labels.map((label, index) => `Image ${index + 1} = ${label}`).join(", ");
  return `${base} Images provided (${labels.length}): ${legend}.`;
}

/** Whether a mode expects JSON output unless the caller says otherwise. */
export function modeImpliesJson(mode: PromptMode): boolean {
  return JSON_PROMPT_MODES.includes(mode);
}

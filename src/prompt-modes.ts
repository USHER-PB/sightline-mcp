export type PromptMode = "general" | "ocr" | "ui-layout" | "error" | "diagram";

export interface PromptModeConfig {
  name: string;
  description: string;
  prompt: string;
}

export const PROMPT_MODES: Record<PromptMode, PromptModeConfig> = {
  general: {
    name: "General",
    description: "Balanced description of the image content",
    prompt: "Describe what you see in this image, including any visible text, UI elements, or relevant details.",
  },
  ocr: {
    name: "OCR / Text Extraction",
    description: "Extract all visible text verbatim",
    prompt: "Extract ALL visible text from this image verbatim. Preserve the exact wording, punctuation, and formatting. Do not describe or interpret - just transcribe the text exactly as it appears. If there are multiple text elements, list them in reading order (top to bottom, left to right).",
  },
  "ui-layout": {
    name: "UI Layout",
    description: "Focus on UI structure, elements, and hierarchy",
    prompt: "Analyze the UI layout and structure of this image. Describe: 1) The overall layout and sections, 2) All UI elements (buttons, inputs, menus, etc.) with their labels, 3) The visual hierarchy and flow, 4) Any notable design patterns or components. Focus on the interface structure, not content.",
  },
  error: {
    name: "Error Detection",
    description: "Identify and explain errors, warnings, or issues",
    prompt: "Analyze this image for errors, warnings, or issues. Identify: 1) Any error messages, stack traces, or warning indicators, 2) The type of error (syntax, runtime, network, etc.), 3) Key details like file names, line numbers, error codes, 4) Suggested causes if apparent. Focus on diagnostic information.",
  },
  diagram: {
    name: "Diagram / Architecture",
    description: "Explain diagrams, flowcharts, or architecture",
    prompt: "Analyze this diagram or visual representation. Describe: 1) The type of diagram (flowchart, architecture, UML, etc.), 2) All components, nodes, or elements and their labels, 3) Connections, relationships, or flows between elements, 4) The overall purpose or what the diagram represents. Be precise about the structure and relationships shown.",
  },
};

/**
 * Get the prompt for a specific mode, optionally with custom instructions appended
 */
export function getPromptForMode(mode: PromptMode, customPrompt?: string): string {
  const modeConfig = PROMPT_MODES[mode];
  
  if (!customPrompt) {
    return modeConfig.prompt;
  }
  
  // If user provides custom prompt, use it instead of mode's default
  return customPrompt;
}

/**
 * Get list of available modes for display
 */
export function listModes(): string {
  return Object.entries(PROMPT_MODES)
    .map(([key, config]) => `- ${key}: ${config.description}`)
    .join("\n");
}

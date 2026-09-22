import { test } from "node:test";
import assert from "node:assert/strict";
import { SightlineError } from "../src/errors.js";
import {
  describeModes,
  getPromptForMode,
  isPromptMode,
  parsePromptMode,
  PROMPT_MODE_NAMES,
  PROMPT_MODES,
  DEFAULT_PROMPT_MODE,
} from "../src/prompt-modes.js";

test("every mode is fully defined", () => {
  assert.ok(PROMPT_MODE_NAMES.length > 0);
  assert.deepEqual(PROMPT_MODE_NAMES, Object.keys(PROMPT_MODES));

  for (const mode of PROMPT_MODE_NAMES) {
    const config = PROMPT_MODES[mode];
    assert.ok(config.name.length > 0, `${mode} needs a display name`);
    assert.ok(config.description.length > 0, `${mode} needs a description`);
    assert.ok(config.prompt.length > 20, `${mode} needs a real prompt`);
  }

  // Prompts must be distinct, otherwise modes are indistinguishable in the cache.
  const prompts = new Set(PROMPT_MODE_NAMES.map((mode) => PROMPT_MODES[mode].prompt));
  assert.equal(prompts.size, PROMPT_MODE_NAMES.length);
});

test("parsePromptMode defaults to general when no mode is given", () => {
  assert.equal(parsePromptMode(undefined), DEFAULT_PROMPT_MODE);
  assert.equal(parsePromptMode(null), DEFAULT_PROMPT_MODE);
  assert.equal(parsePromptMode(""), DEFAULT_PROMPT_MODE);
  assert.equal(DEFAULT_PROMPT_MODE, "general");
});

test("parsePromptMode accepts every known mode", () => {
  for (const mode of PROMPT_MODE_NAMES) {
    assert.equal(parsePromptMode(mode), mode);
    assert.ok(isPromptMode(mode));
  }
});

test("parsePromptMode rejects unknown modes with actionable details", () => {
  try {
    parsePromptMode("bogus");
    assert.fail("expected parsePromptMode to throw");
  } catch (error) {
    assert.ok(error instanceof SightlineError);
    assert.equal(error.code, "invalid_input");
    assert.match(error.message, /bogus/);
    assert.match(error.hint ?? "", /general/);
    assert.match(error.hint ?? "", /ocr/);
  }
});

test("getPromptForMode returns the preset prompt", () => {
  for (const mode of PROMPT_MODE_NAMES) {
    assert.equal(getPromptForMode(mode), PROMPT_MODES[mode].prompt);
  }
});

test("getPromptForMode replaces the preset when a custom prompt is given", () => {
  assert.equal(getPromptForMode("ocr", "What error is shown?"), "What error is shown?");
  assert.equal(getPromptForMode("ocr", "  trimmed  "), "trimmed");
  // Blank custom prompts must not disable the mode's preset.
  assert.equal(getPromptForMode("ocr", "   "), PROMPT_MODES.ocr.prompt);
});

test("describeModes mentions every mode and its description", () => {
  const described = describeModes();
  for (const mode of PROMPT_MODE_NAMES) {
    assert.ok(described.includes(`'${mode}'`), `describeModes must mention ${mode}`);
    assert.ok(described.includes(PROMPT_MODES[mode].description));
  }
});

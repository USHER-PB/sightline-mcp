import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonSubstring,
  isOutputFormat,
  JSON_INSTRUCTION,
  parseJsonResponse,
  stripCodeFence,
  toStructuredContent,
  withJsonInstruction,
} from "../src/output-format.js";

test("isOutputFormat accepts only text and json", () => {
  assert.equal(isOutputFormat("text"), true);
  assert.equal(isOutputFormat("json"), true);
  assert.equal(isOutputFormat("yaml"), false);
  assert.equal(isOutputFormat(undefined), false);
  assert.equal(isOutputFormat(42), false);
});

test("withJsonInstruction appends once and is idempotent", () => {
  const once = withJsonInstruction("Describe this image.");
  assert.ok(once.includes(JSON_INSTRUCTION));
  assert.ok(once.startsWith("Describe this image."));

  const twice = withJsonInstruction(once);
  assert.equal(twice, once, "must not append the instruction twice");
});

test("stripCodeFence removes a fenced JSON block", () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('{"a":1}'), '{"a":1}');
});

test("extractJsonSubstring finds balanced JSON in surrounding prose", () => {
  assert.equal(
    extractJsonSubstring('Here is the result: {"a":1,"b":[2,3]} hope it helps'),
    '{"a":1,"b":[2,3]}'
  );
  assert.equal(extractJsonSubstring('note: {"a": "}"} tail'), '{"a": "}"}');
  assert.equal(extractJsonSubstring("no json at all"), null);
});

test("parseJsonResponse handles bare JSON", () => {
  const result = parseJsonResponse('{"answer":42}');
  assert.ok(result.ok);
  assert.deepEqual(result.value, { answer: 42 });
});

test("parseJsonResponse handles fenced JSON", () => {
  const result = parseJsonResponse('```json\n{"answer":42}\n```');
  assert.ok(result.ok);
  assert.deepEqual(result.value, { answer: 42 });
});

test("parseJsonResponse handles JSON embedded in prose", () => {
  const result = parseJsonResponse('Sure! Here you go: {"answer":42} — let me know.');
  assert.ok(result.ok);
  assert.deepEqual(result.value, { answer: 42 });
});

test("parseJsonResponse handles top-level arrays", () => {
  const result = parseJsonResponse('[1,2,3]');
  assert.ok(result.ok);
  assert.deepEqual(result.value, [1, 2, 3]);
});

test("parseJsonResponse fails cleanly on empty or non-JSON text", () => {
  const empty = parseJsonResponse("   ");
  assert.equal(empty.ok, false);

  const prose = parseJsonResponse("The screenshot shows a login form.");
  assert.equal(prose.ok, false);
  assert.match(prose.error, /not valid JSON/);
});

test("toStructuredContent keeps objects and wraps other shapes", () => {
  assert.deepEqual(toStructuredContent({ a: 1 }), { a: 1 });
  assert.deepEqual(toStructuredContent([1, 2]), { results: [1, 2] });
  assert.deepEqual(toStructuredContent("text"), { result: "text" });
  assert.deepEqual(toStructuredContent(null), { result: null });
});

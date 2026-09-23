import { test } from "node:test";
import assert from "node:assert/strict";
import { SightlineError } from "../src/errors.js";
import {
  BackendFactory,
  BackendManager,
  createBackendManager,
  parseBackendOrder,
} from "../src/backend-manager.js";
import { VisionBackend } from "../src/vision-backend.js";
import { silenceConsoleErrors } from "./test-helpers.js";

type BackendTypeKey = "gemini" | "ollama";

function backend(
  name: string,
  describe: VisionBackend["describe"],
  probe?: () => Promise<boolean>
): VisionBackend {
  return { name, describe, probe };
}

function factoryFor(...backends: (VisionBackend | null)[]): Partial<Record<BackendTypeKey, BackendFactory>> {
  return {
    gemini: () => backends[0],
    ollama: () => backends[1] ?? null,
  };
}

const succeed = (description: string): VisionBackend["describe"] => async () => description;
const fail = (message: string): VisionBackend["describe"] => async () => {
  throw new Error(message);
};

test("uses the primary backend when it works", async () => {
  const manager = new BackendManager(
    { backends: ["gemini", "ollama"] },
    factoryFor(backend("Primary", succeed("primary result")), backend("Secondary", succeed("secondary")))
  );

  const result = await manager.describe({
    prompt: "prompt",
    images: [{ data: "base64", mimeType: "image/png" }],
  });
  assert.equal(result.backend, "Primary");
  assert.equal(result.description, "primary result");
  assert.equal(manager.currentBackend.name, "Primary");
  assert.deepEqual(manager.listBackends(), ["Primary", "Secondary"]);
});

test("falls back to the next backend and remembers it", async () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = new BackendManager(
      { backends: ["gemini", "ollama"] },
      factoryFor(
        backend("Primary", fail("quota exceeded")),
        backend("Secondary", succeed("secondary result"))
      )
    );

    const result = await manager.describe({
      prompt: "prompt",
      images: [{ data: "base64", mimeType: "image/png" }],
    });
    assert.equal(result.backend, "Secondary");
    assert.equal(manager.currentBackend.name, "Secondary");

    const statuses = manager.describeBackends();
    assert.equal(statuses[0].available, false);
    assert.match(statuses[0].note ?? "", /quota exceeded/);
    assert.equal(statuses[1].available, true);
  } finally {
    restore();
  }
});

test("reports every backend failure when all of them fail", async () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = new BackendManager(
      { backends: ["gemini", "ollama"] },
      factoryFor(backend("Primary", fail("no api key")), backend("Secondary", fail("ollama down")))
    );

    try {
      await manager.describe({
        prompt: "prompt",
        images: [{ data: "base64", mimeType: "image/png" }],
      });
      assert.fail("expected describe to reject");
    } catch (error) {
      assert.ok(error instanceof SightlineError);
      assert.equal(error.code, "backend_unavailable");
      assert.match(error.message, /Primary: no api key/);
      assert.match(error.message, /Secondary: ollama down/);
      assert.match(error.hint ?? "", /ollama serve/);
    }
  } finally {
    restore();
  }
});

test("skips unconfigured backends and refuses to start without any", () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = new BackendManager(
      { backends: ["gemini", "ollama"] },
      factoryFor(null, backend("Secondary", succeed("ok")))
    );
    assert.deepEqual(manager.listBackends(), ["Secondary"]);

    assert.throws(
      () => new BackendManager({ backends: ["gemini"] }, factoryFor(null)),
      /No vision backends available/
    );
  } finally {
    restore();
  }
});

test("warns about unknown backend names", () => {
  const restore = silenceConsoleErrors();
  try {
    assert.throws(
      () =>
        new BackendManager(
          { backends: ["bogus" as BackendTypeKey] },
          factoryFor(backend("Primary", succeed("ok")))
        ),
      /No vision backends available/
    );
  } finally {
    restore();
  }
});

test("probes backends at startup without dropping unreachable ones", async () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = await BackendManager.create(
      { backends: ["gemini", "ollama"] },
      factoryFor(
        backend("Primary", succeed("ok")),
        backend("Secondary", succeed("ok"), async () => false)
      )
    );

    const statuses = manager.describeBackends();
    assert.deepEqual(
      statuses.map((status) => [status.name, status.available]),
      [
        ["Primary", true],
        ["Secondary", false],
      ]
    );
    assert.deepEqual(manager.listBackends(), ["Primary", "Secondary"]);
  } finally {
    restore();
  }
});

test("treats a throwing probe as unavailable", async () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = await BackendManager.create(
      { backends: ["gemini"] },
      factoryFor(
        backend("Primary", succeed("ok"), async () => {
          throw new Error("connection refused");
        })
      )
    );

    const status = manager.describeBackends()[0];
    assert.equal(status.available, false);
    assert.match(status.note ?? "", /connection refused/);
  } finally {
    restore();
  }
});

test("parseBackendOrder handles defaults, order, and junk", () => {
  const restore = silenceConsoleErrors();
  try {
    assert.deepEqual(parseBackendOrder(undefined, "key"), ["gemini", "ollama"]);
    assert.deepEqual(parseBackendOrder(undefined, undefined), ["ollama"]);
    assert.deepEqual(parseBackendOrder("ollama,gemini", "key"), ["ollama", "gemini"]);
    assert.deepEqual(parseBackendOrder(" OLLAMA ", "key"), ["ollama"]);
    // A malformed value must not disable vision entirely.
    assert.deepEqual(parseBackendOrder("bogus", "key"), ["gemini", "ollama"]);
    assert.deepEqual(parseBackendOrder("bogus,ollama", "key"), ["ollama"]);
  } finally {
    restore();
  }
});

test("createBackendManager reads configuration from the environment", async () => {
  const restore = silenceConsoleErrors();
  try {
    const manager = await createBackendManager(
      { SIGHTLINE_BACKENDS: "ollama", OLLAMA_VISION_MODEL: "llava" },
      factoryFor(backend("Primary", succeed("ok")), backend("Ollama", succeed("ok")))
    );

    assert.deepEqual(manager.listBackends(), ["Ollama"]);
  } finally {
    restore();
  }
});


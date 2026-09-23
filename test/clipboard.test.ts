import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureStamp,
  ClipboardWatcher,
  CLIPBOARD_TOOLS,
  detectClipboardTool,
  ExecBuffer,
  pickImageTarget,
} from "../src/clipboard.js";
import { PNG_BYTES, silenceConsoleErrors } from "./test-helpers.js";

/** A scriptable stand-in for the system clipboard and its CLI tools. */
function makeFakeClipboard(options: {
  available?: string[];
  image?: Buffer | null;
  targets?: string[];
} = {}) {
  const available = new Set(options.available ?? ["xclip"]);
  let image: Buffer | null = options.image ?? null;
  let targets: string[] = options.targets ?? (image ? ["image/png"] : []);
  const calls: string[][] = [];

  const exec: ExecBuffer = async (command, args) => {
    calls.push([command, ...args]);
    if (!available.has(command)) throw new Error(`${command}: command not found`);

    if (args.includes("--version") || args.includes("-version")) {
      return Buffer.from(`${command} test`);
    }

    if (args.includes("TARGETS") || args.includes("--list-types")) {
      return Buffer.from(targets.length > 0 ? `${targets.join("\n")}\n` : "");
    }

    if (!image) throw new Error("nothing on the clipboard");
    return image;
  };

  return {
    exec,
    calls,
    setImage(bytes: Buffer | null) {
      image = bytes;
      targets = bytes ? ["image/png"] : [];
    },
    setTargets(next: string[]) {
      targets = next;
    },
  };
}

const XCLIP = CLIPBOARD_TOOLS[1];

function makeWatcher(clipboard: ReturnType<typeof makeFakeClipboard>) {
  const writes: { path: string; data: Buffer }[] = [];
  const captures: string[] = [];
  const watcher = new ClipboardWatcher({
    folder: "/tmp/sightline-watch",
    tool: XCLIP,
    exec: clipboard.exec,
    writeFile: async (path, data) => {
      writes.push({ path, data });
    },
    now: () => new Date("2026-09-23T10:40:12.345Z"),
    onCapture: (capture) => captures.push(capture.name),
  });
  return { watcher, writes, captures };
}

test("detectClipboardTool prefers wl-paste and falls back to xclip", async () => {
  const both = makeFakeClipboard({ available: ["wl-paste", "xclip"] });
  assert.equal((await detectClipboardTool(both.exec))?.name, "wl-paste");

  const onlyXclip = makeFakeClipboard({ available: ["xclip"] });
  assert.equal((await detectClipboardTool(onlyXclip.exec))?.name, "xclip");

  const neither = makeFakeClipboard({ available: [] });
  assert.equal(await detectClipboardTool(neither.exec), null);
});

test("pickImageTarget prefers png and ignores non-image targets", () => {
  assert.equal(pickImageTarget(["TARGETS", "UTF8_STRING", "image/png"])?.extension, ".png");
  assert.equal(pickImageTarget(["image/jpeg", "image/png"])?.target, "image/png");
  assert.equal(pickImageTarget(["image/jpeg"])?.extension, ".jpg");
  assert.equal(pickImageTarget(["image/webp"])?.mimeType, "image/webp");
  assert.equal(pickImageTarget(["  IMAGE/PNG  "])?.mimeType, "image/png");
  assert.equal(pickImageTarget(["UTF8_STRING", "text/plain"]), null);
  assert.equal(pickImageTarget([]), null);
});

test("captureStamp yields a filesystem-safe timestamp", () => {
  const stamp = captureStamp(new Date("2026-09-23T10:40:12.345Z"));
  assert.equal(stamp, "2026-09-23T10-40-12-345");
  assert.ok(!stamp.includes(":"), "colons are unsafe in file names");
  assert.ok(!stamp.includes("."), "a dot would look like an extension");
});

test("pollOnce saves a newly copied image and reports it", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher, writes, captures } = makeWatcher(clipboard);

  const capture = await watcher.pollOnce();

  assert.ok(capture);
  assert.equal(capture.mimeType, "image/png");
  assert.equal(capture.bytes, PNG_BYTES.length);
  assert.equal(capture.name, "clipboard-2026-09-23T10-40-12-345.png");
  assert.equal(capture.path, "/tmp/sightline-watch/clipboard-2026-09-23T10-40-12-345.png");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data, PNG_BYTES);
  assert.deepEqual(captures, [capture.name]);
});

test("the same image is not captured twice while it stays on the clipboard", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher, writes } = makeWatcher(clipboard);

  assert.ok(await watcher.pollOnce());
  assert.equal(await watcher.pollOnce(), null);
  assert.equal(await watcher.pollOnce(), null);
  assert.equal(writes.length, 1, "an unchanged clipboard must not be re-saved");
});

test("a different image is captured", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher, writes } = makeWatcher(clipboard);

  await watcher.pollOnce();
  clipboard.setImage(Buffer.concat([PNG_BYTES, Buffer.from([0])]));
  assert.ok(await watcher.pollOnce());
  assert.equal(writes.length, 2);
});

test("re-copying an image after copying something else captures it again", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher, writes } = makeWatcher(clipboard);

  await watcher.pollOnce();
  clipboard.setImage(null); // the user copies text instead
  assert.equal(await watcher.pollOnce(), null);
  clipboard.setImage(PNG_BYTES); // ...then copies the same image again
  assert.ok(await watcher.pollOnce());
  assert.equal(writes.length, 2);
});

test("pollOnce does nothing when the clipboard holds no image", async () => {
  const clipboard = makeFakeClipboard({ targets: ["TARGETS", "UTF8_STRING"] });
  const { watcher, writes, captures } = makeWatcher(clipboard);

  assert.equal(await watcher.pollOnce(), null);
  assert.equal(writes.length, 0);
  assert.equal(captures.length, 0);
});

test("pollOnce without a tool is a no-op", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const watcher = new ClipboardWatcher({
    folder: "/tmp/sightline-watch",
    tool: null,
    exec: clipboard.exec,
    writeFile: async () => {},
  });

  assert.equal(await watcher.pollOnce(), null);
});

test("a failing write or read never throws out of pollOnce", async () => {
  const restore = silenceConsoleErrors();
  try {
    const clipboard = makeFakeClipboard({ image: PNG_BYTES });
    const failingWrite = new ClipboardWatcher({
      folder: "/tmp/sightline-watch",
      tool: XCLIP,
      exec: clipboard.exec,
      writeFile: async () => {
        throw new Error("disk full");
      },
    });
    assert.equal(await failingWrite.pollOnce(), null);

    const failingRead: ExecBuffer = async (_command, args) => {
      if (args.includes("TARGETS")) return Buffer.from("image/png\n");
      throw new Error("clipboard owner vanished");
    };
    const brokenRead = new ClipboardWatcher({
      folder: "/tmp/sightline-watch",
      tool: XCLIP,
      exec: failingRead,
      writeFile: async () => {},
    });
    assert.equal(await brokenRead.pollOnce(), null);
  } finally {
    restore();
  }
});

test("start reports failure when no clipboard tool exists", async () => {
  const clipboard = makeFakeClipboard({ available: [], image: PNG_BYTES });
  const watcher = new ClipboardWatcher({
    folder: "/tmp/sightline-watch",
    exec: clipboard.exec,
    writeFile: async () => {},
  });

  assert.equal(await watcher.start(), false);
  assert.equal(watcher.active, false);
  assert.equal(watcher.toolName, null);
});

test("start baselines the existing clipboard instead of harvesting it", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher, writes } = makeWatcher(clipboard);

  try {
    assert.equal(await watcher.start(), true);
    assert.equal(watcher.active, true);
    assert.equal(watcher.toolName, "xclip");
    assert.equal(writes.length, 0, "a pre-existing clipboard image must not be saved");
    assert.equal(await watcher.pollOnce(), null, "the baselined image is not new");

    clipboard.setImage(Buffer.concat([PNG_BYTES, Buffer.from([7])]));
    assert.ok(await watcher.pollOnce(), "a later copy is captured");
    assert.equal(writes.length, 1);
  } finally {
    watcher.stop();
  }

  assert.equal(watcher.active, false);
});

test("start is idempotent and stop is safe to call twice", async () => {
  const clipboard = makeFakeClipboard({ image: PNG_BYTES });
  const { watcher } = makeWatcher(clipboard);

  assert.equal(await watcher.start(), true);
  assert.equal(await watcher.start(), true);
  watcher.stop();
  watcher.stop();
  assert.equal(watcher.active, false);
});


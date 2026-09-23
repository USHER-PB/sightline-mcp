import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestThrottle } from "../src/throttle.js";

/** A controllable clock+sleep so spacing assertions stay deterministic. */
function fakeClock() {
  let now = 0;
  const pending: (() => void)[] = [];
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          now += ms;
          resolve();
        });
      }),
    /** Advance time without waiting on a scheduled sleep. */
    elapse(ms: number) {
      now += ms;
    },
    /** Run the next scheduled sleep callback, if any. */
    async flushSleep(): Promise<boolean> {
      const next = pending.shift();
      if (!next) return false;
      next();
      await Promise.resolve();
      return true;
    },
    get waitingSleeps() {
      return pending.length;
    },
  };
}

test("limits concurrency to maxConcurrent", async () => {
  const throttle = new RequestThrottle({ maxConcurrent: 1, minIntervalMs: 0 });
  let active = 0;
  let peak = 0;

  const task = async (id: number) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return id;
  };

  const results = await Promise.all([
    throttle.run(() => task(1)),
    throttle.run(() => task(2)),
    throttle.run(() => task(3)),
  ]);

  assert.equal(peak, 1, "never more than one task may run at once");
  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(throttle.stats().active, 0);
  assert.equal(throttle.stats().queued, 0);
});

test("releases the slot when a task throws", async () => {
  const throttle = new RequestThrottle({ maxConcurrent: 1, minIntervalMs: 0 });

  await assert.rejects(
    () => throttle.run(() => Promise.reject(new Error("boom"))),
    /boom/
  );

  // A failing task must not wedge the queue.
  assert.equal(await throttle.run(() => Promise.resolve("still works")), "still works");
  assert.equal(throttle.stats().active, 0);
});

test("spaces task starts by minIntervalMs", async () => {
  const clock = fakeClock();
  const throttle = new RequestThrottle({
    maxConcurrent: 1,
    minIntervalMs: 100,
    now: clock.now,
    sleep: clock.sleep,
  });

  const starts: number[] = [];
  const task = async () => {
    starts.push(clock.now());
  };

  const first = throttle.run(task);
  const second = throttle.run(task);

  // Once the first task finishes, the spacing sleep for the second must exist.
  await first;
  assert.deepEqual(starts, [0], "the first task starts immediately");
  assert.ok(await clock.flushSleep(), "a spacing sleep must be scheduled");

  await second;
  assert.deepEqual(starts, [0, 100]);
});

test("stats reports the configured limits", () => {
  const throttle = new RequestThrottle({ maxConcurrent: 4, minIntervalMs: 250 });
  const stats = throttle.stats();
  assert.equal(stats.maxConcurrent, 4);
  assert.equal(stats.minIntervalMs, 250);
  assert.equal(stats.active, 0);
  assert.equal(stats.queued, 0);
});

test("clamps invalid configuration instead of failing", () => {
  const throttle = new RequestThrottle({ maxConcurrent: 0, minIntervalMs: -5 });
  const stats = throttle.stats();
  assert.equal(stats.maxConcurrent, 1, "concurrency below 1 is raised to 1");
  assert.equal(stats.minIntervalMs, 0, "negative spacing is clamped to 0");
});

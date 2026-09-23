/**
 * Serialises vision work so a coding agent cannot hammer a shared API quota or
 * thrash a local model by issuing tool calls in parallel.
 */
export interface ThrottleOptions {
  /** How many backend calls may be in flight at once. */
  maxConcurrent: number;
  /** Minimum delay between the start of two backend calls. */
  minIntervalMs: number;
  /** Injectable clock/sleep for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ThrottleStats {
  active: number;
  queued: number;
  maxConcurrent: number;
  minIntervalMs: number;
}

export class RequestThrottle {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private active = 0;
  private lastStart = Number.NEGATIVE_INFINITY;
  private waiting = false;
  private readonly queue: (() => void)[] = [];

  constructor(options: ThrottleOptions) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent);
    this.minIntervalMs = Math.max(0, options.minIntervalMs);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Run a task once a slot is free. The slot is released even when the task
   * throws, so a failing backend cannot wedge the queue.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  stats(): ThrottleStats {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      minIntervalMs: this.minIntervalMs,
    };
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
  }

  private release(): void {
    this.active--;
    this.pump();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const wait = this.minIntervalMs - (this.now() - this.lastStart);

      if (wait > 0) {
        // Not enough spacing yet: defer instead of blocking the loop.
        if (!this.waiting) {
          this.waiting = true;
          void this.sleep(wait).then(() => {
            this.waiting = false;
            this.pump();
          });
        }
        return;
      }

      const start = this.queue.shift();
      if (!start) return;

      this.active++;
      this.lastStart = this.now();
      start();
    }
  }
}

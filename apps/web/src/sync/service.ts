import type { PersistRecord } from "@gymspot/engine";
import type { RecordQueue } from "./queue";

// Keeps the record queue draining: flush right after a push, then retry
// with the queue's backoff while anything is pending (specs/02).

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class SyncService {
  private timer: unknown;
  private stopped = false;

  constructor(
    private readonly queue: RecordQueue,
    private readonly timers: Timers = browserTimers,
  ) {}

  push(record: PersistRecord): Promise<void> {
    return this.queue.enqueue(record).then(() => this.kick());
  }

  /** Flush now and schedule retries while records remain. */
  async kick(): Promise<void> {
    if (this.stopped) return;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    await this.queue.flush();
    if (!this.stopped && (await this.queue.pending()) > 0) {
      this.timer = this.timers.setTimeout(() => void this.kick(), this.queue.nextDelayMs());
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
  }
}

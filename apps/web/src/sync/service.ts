import type { PersistRecord } from "@gymspot/engine";
import { PersistRecordSchema } from "@gymspot/shared";
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

  /** Validates against the strict shared schema first: nothing beyond the record fields can be queued (AC-7.1). */
  push(record: PersistRecord): Promise<void> {
    const check = PersistRecordSchema.safeParse(record);
    if (!check.success) return Promise.reject(new Error(`refusing to queue an invalid ${record.kind} record`));
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

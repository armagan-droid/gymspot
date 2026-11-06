import type { PersistRecord } from "@gymspot/engine";

// Offline record queue — specs/02 "Çevrimdışı dayanıklılık", specs/06 "Kayıt alımı".
// Records survive reloads (IndexedDB in the app); the server answers per record.

export interface IngestResult {
  id: string | null;
  kind: string | null;
  status: "ok" | "duplicate" | "retry" | "rejected";
  reason?: string;
}

export interface QueuedRecord {
  record: PersistRecord;
  enqueuedAt: number;
  attempts: number;
}

export interface QueueStorage {
  load(): Promise<QueuedRecord[]>;
  save(items: QueuedRecord[]): Promise<void>;
}

/** Sends a batch; throws on network/server errors (the whole batch is kept). */
export type IngestSender = (records: PersistRecord[]) => Promise<IngestResult[]>;

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const MAX_RECORD_AGE_MS = 7 * 24 * 60 * 60_000;
const ORDER = { session: 0, session_block: 1, set: 2, rep: 3 } as const;

export interface RecordQueueOptions {
  storage: QueueStorage;
  send: IngestSender;
  now?: () => number;
  batchSize?: number;
  /** Called with records dropped after MAX_RECORD_AGE_MS (orphans that can never land). */
  onDrop?: (dropped: QueuedRecord[]) => void;
}

export class RecordQueue {
  private items: QueuedRecord[] | undefined;
  private inFlight: Promise<{ sent: number; kept: number; dropped: number }> | undefined;
  private failures = 0;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: RecordQueueOptions) {}

  private now() {
    return (this.o.now ?? Date.now)();
  }

  /** Serializes access to the item list (enqueue can happen during a flush). */
  private exclusive<T>(fn: (items: QueuedRecord[]) => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      this.items ??= await this.o.storage.load();
      return fn(this.items);
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  async enqueue(record: PersistRecord): Promise<void> {
    await this.exclusive(async (items) => {
      items.push({ record, enqueuedAt: this.now(), attempts: 0 });
      await this.o.storage.save(items);
    });
  }

  pending(): Promise<number> {
    return this.exclusive(async (items) => items.length);
  }

  /** Delay before the next attempt: 1 s after success, doubling per failure up to 5 min. */
  nextDelayMs(): number {
    return Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.failures);
  }

  flush(): Promise<{ sent: number; kept: number; dropped: number }> {
    this.inFlight ??= this.doFlush().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async doFlush() {
    const now = this.now();
    // take a snapshot; records enqueued meanwhile stay in the list
    const { batch, dropped } = await this.exclusive(async (items) => {
      const expired = items.filter((i) => now - i.enqueuedAt > MAX_RECORD_AGE_MS);
      const live = items.filter((i) => now - i.enqueuedAt <= MAX_RECORD_AGE_MS);
      items.splice(0, items.length, ...live);
      if (expired.length > 0) await this.o.storage.save(items);
      return { batch: [...live], dropped: expired };
    });
    if (dropped.length > 0) this.o.onDrop?.(dropped);

    const ordered = batch
      .map((item, i) => ({ item, i }))
      .sort((a, b) => ORDER[a.item.record.kind] - ORDER[b.item.record.kind] || a.i - b.i)
      .map((x) => x.item);
    const size = this.o.batchSize ?? 200;
    const done = new Set<QueuedRecord>();
    const retried = new Set<QueuedRecord>();
    let sent = 0;
    try {
      for (let i = 0; i < ordered.length; i += size) {
        const chunk = ordered.slice(i, i + size);
        const results = await this.o.send(chunk.map((c) => c.record));
        sent += chunk.length;
        chunk.forEach((c, j) => (results[j]?.status === "retry" ? retried : done).add(c));
      }
      this.failures = 0;
    } catch {
      this.failures++;
    }

    const kept = await this.exclusive(async (items) => {
      const remaining = items.filter((i) => !done.has(i));
      remaining.forEach((i) => retried.has(i) && i.attempts++);
      items.splice(0, items.length, ...remaining);
      await this.o.storage.save(items);
      return retried.size;
    });
    return { sent, kept, dropped: dropped.length };
  }
}

/** Browser storage: one IndexedDB object store holding the queue. */
export function indexedDbStorage(name = "gymspot-sync"): QueueStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("queue");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const tx = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction("queue", mode).objectStore("queue"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  };
  return {
    load: async () => ((await tx("readonly", (s) => s.get("records"))) as QueuedRecord[] | undefined) ?? [],
    save: async (items) => void (await tx("readwrite", (s) => s.put(items, "records"))),
  };
}

/** POST /ingest with the current access token. */
export function apiSender(baseUrl: string, accessToken: () => string | null): IngestSender {
  return async (records) => {
    const token = accessToken();
    const res = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) throw new Error(`ingest failed: ${res.status}`);
    return ((await res.json()) as { results: IngestResult[] }).results;
  };
}

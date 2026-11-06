import type { PersistRecord } from "@gymspot/engine";
import { describe, expect, test, vi } from "vitest";
import { type IngestResult, type QueueStorage, type QueuedRecord, MAX_BACKOFF_MS, MAX_RECORD_AGE_MS, RecordQueue } from "./queue";

const T0 = Date.UTC(2026, 10, 6, 10);
const rec = (kind: PersistRecord["kind"], id: string) => ({ kind, data: { id } }) as unknown as PersistRecord;

function memoryStorage(initial: QueuedRecord[] = []): QueueStorage & { items: QueuedRecord[] } {
  const s = {
    items: structuredClone(initial),
    load: vi.fn(async () => structuredClone(s.items)),
    save: vi.fn(async (items: QueuedRecord[]) => void (s.items = structuredClone(items))),
  };
  return s;
}

/** A sender answering each record with the status chosen by `decide`. */
function sender(decide: (r: PersistRecord) => IngestResult["status"] = () => "ok") {
  return vi.fn(async (records: PersistRecord[]) => records.map((r) => ({ id: r.data.id, kind: r.kind, status: decide(r) })));
}

function queue(o: { storage?: ReturnType<typeof memoryStorage>; send?: ReturnType<typeof sender>; now?: () => number; batchSize?: number } = {}) {
  const storage = o.storage ?? memoryStorage();
  const send = o.send ?? sender();
  const onDrop = vi.fn();
  const q = new RecordQueue({ storage, send, now: o.now ?? (() => T0), batchSize: o.batchSize, onDrop });
  return { q, storage, send, onDrop };
}

describe("RecordQueue (specs/02 offline, specs/06 ingestion)", () => {
  test("enqueued records survive a reload", async () => {
    const { q, storage } = queue();
    await q.enqueue(rec("session", "s1"));
    await q.enqueue(rec("rep", "r1"));
    const reloaded = new RecordQueue({ storage, send: sender(), now: () => T0 });
    expect(await reloaded.pending()).toBe(2);
  });

  test("flush sends parents before children and empties the queue on success", async () => {
    const { q, send } = queue();
    for (const r of [rec("session", "s1"), rec("rep", "r1"), rec("rep", "r2"), rec("set", "x1"), rec("session_block", "b1"), rec("session", "s1")]) {
      await q.enqueue(r);
    }
    expect(await q.flush()).toMatchObject({ sent: 6, kept: 0, dropped: 0 });
    expect(send.mock.calls[0]![0].map((r) => `${r.kind}:${r.data.id}`)).toEqual([
      "session:s1",
      "session:s1",
      "session_block:b1",
      "set:x1",
      "rep:r1",
      "rep:r2",
    ]);
    expect(await q.pending()).toBe(0);
  });

  test("duplicate and rejected are removed, retry is kept for the next flush", async () => {
    const statuses: Record<string, IngestResult["status"]> = { a: "duplicate", b: "rejected", c: "retry" };
    const { q } = queue({ send: sender((r) => statuses[r.data.id]!) });
    for (const id of ["a", "b", "c"]) await q.enqueue(rec("rep", id));
    expect(await q.flush()).toMatchObject({ sent: 3, kept: 1 });
    expect(await q.pending()).toBe(1);
  });

  test("a network error keeps everything and backs off exponentially up to 5 min", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const { q } = queue({ send: failing as never });
    await q.enqueue(rec("rep", "a"));
    const delays: number[] = [];
    for (let i = 0; i < 12; i++) {
      await q.flush();
      delays.push(q.nextDelayMs());
    }
    expect(await q.pending()).toBe(1);
    expect(delays.slice(0, 4)).toEqual([2000, 4000, 8000, 16000]);
    expect(delays.at(-1)).toBe(MAX_BACKOFF_MS);
  });

  test("success resets the backoff", async () => {
    let fail = true;
    const send = vi.fn(async (records: PersistRecord[]) => {
      if (fail) throw new Error("offline");
      return records.map((r) => ({ id: r.data.id, kind: r.kind, status: "ok" as const }));
    });
    const { q } = queue({ send: send as never });
    await q.enqueue(rec("rep", "a"));
    await q.flush();
    await q.flush();
    fail = false;
    await q.flush();
    expect(q.nextDelayMs()).toBe(1000);
  });

  test("records older than 7 days are dropped and reported", async () => {
    let now = T0;
    const { q, onDrop } = queue({ send: sender(() => "retry"), now: () => now });
    await q.enqueue(rec("rep", "orphan"));
    now += MAX_RECORD_AGE_MS + 1;
    expect(await q.flush()).toMatchObject({ dropped: 1 });
    expect(onDrop).toHaveBeenCalledWith([expect.objectContaining({ record: expect.objectContaining({ kind: "rep" }) })]);
    expect(await q.pending()).toBe(0);
  });

  test("large queues go out in batches", async () => {
    const { q, send } = queue({ batchSize: 2 });
    for (const id of ["a", "b", "c", "d", "e"]) await q.enqueue(rec("rep", id));
    await q.flush();
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([2, 2, 1]);
  });

  test("concurrent flushes share one request", async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(
      (records: PersistRecord[]) =>
        new Promise<IngestResult[]>((res) => {
          release = () => res(records.map((r) => ({ id: r.data.id, kind: r.kind, status: "ok" })));
        }),
    );
    const { q } = queue({ send: send as never });
    await q.enqueue(rec("rep", "a"));
    const p1 = q.flush();
    const p2 = q.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([p1, p2]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("records enqueued during a flush are not lost", async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(
      (records: PersistRecord[]) =>
        new Promise<IngestResult[]>((res) => {
          release = () => res(records.map((r) => ({ id: r.data.id, kind: r.kind, status: "ok" })));
        }),
    );
    const { q } = queue({ send: send as never });
    await q.enqueue(rec("rep", "a"));
    const p = q.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await q.enqueue(rec("rep", "b"));
    release();
    await p;
    expect(await q.pending()).toBe(1);
  });
});

import type { PersistRecord } from "@gymspot/engine";
import type { Frame } from "@gymspot/shared";
import { vi } from "vitest";
import type { CredentialStore, GymApi } from "./api/client";
import type { PoseSource } from "./pose/source";
import type { AppServices } from "./services";
import type { QrScanner } from "./station/scanner";

/** Fake services for component tests: scripted camera, scanner and API. */
export function testServices(o: { api?: Partial<GymApi>; credentials?: Record<string, unknown>; online?: boolean } = {}) {
  const clock = { now: Date.UTC(2026, 10, 6, 10) };
  const creds: Record<string, unknown> = { ...o.credentials };
  const store: CredentialStore = { get: (k) => (creds[k] as never) ?? null, set: (k, v) => void (creds[k] = v), clear: (k) => void delete creds[k] };
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const records: { as: string; record: PersistRecord }[] = [];
  const pose = { emit: undefined as ((c: Frame[], t: number) => void) | undefined, sources: 0 };
  const scanner = { onCode: undefined as ((text: string) => void) | undefined };
  let n = 0;

  const services: AppServices = {
    api: { ...o.api } as GymApi,
    store,
    storage,
    requestCamera: vi.fn(async () => ({ ok: true as const, stream: {} as MediaStream })),
    createPoseSource: (): PoseSource => {
      pose.sources++;
      return { start: async (_v, cb) => void (pose.emit = cb), stop: () => undefined };
    },
    createScanner: (): QrScanner => ({ start: (_v, cb) => void (scanner.onCode = cb), stop: () => undefined }),
    createSync: (as) => ({ push: async (record) => void records.push({ as, record }) }),
    cueDeps: () => ({ files: new Set(), playFile: () => undefined }),
    now: () => clock.now, // components capture the function; tests move `clock`
    online: () => o.online ?? true,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
  return { services, creds, storage, records, pose, scanner, clock };
}

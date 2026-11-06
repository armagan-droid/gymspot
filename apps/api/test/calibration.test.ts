import { squatSequence } from "@gymspot/engine/testing";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { MemoryBlobStore, decryptBlob } from "../src/calibration/store";
import { purgeExpiredRecordings } from "../src/calibration/purge";
import { type Database, createDb } from "../src/db/db";
import { A, T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let store: MemoryBlobStore;
let manager: string;
let trainer: string;
const key = new Uint8Array(32).fill(9);

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  await seedTenants(db);
  store = new MemoryBlobStore();
  api = testApi(db, { calibrationKey: key }, store);
  manager = await api.staffToken("yonetici@a.test");
  trainer = await api.staffToken("pt@a.test");
});

const sequence = () => ({
  ...squatSequence({ view: "front", reps: [{ kneeAngle: 90, label: { outcome: "valid", faults: [] } }], seed: 1 }),
  source: "calibration" as const,
});

async function consent(token = manager) {
  return api.call("POST", "/calibration/consents", token, { participantRef: "P-007", consentVersion: "2026-11-v1", consentedAt: "2026-11-06T10:00:00.000Z" });
}

describe("AC-7.5: calibration uploads (specs/07)", () => {
  test("only managers/owners record consents and upload", async () => {
    expect((await consent(trainer)).status).toBe(403);
    const memberToken = await (async () => {
      await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" });
      return api.memberToken("ayse@a.test");
    })();
    expect((await api.call("POST", "/calibration/recordings", memberToken, {})).status).toBe(403);
  });

  test("an upload needs an existing, unwithdrawn consent", async () => {
    const missing = await api.call("POST", "/calibration/recordings", manager, { consentId: "c0000000-0000-4000-8000-000000000001", sequence: sequence() });
    expect(missing.status).toBe(409);
    const { id } = (await consent()).json();
    await api.call("POST", `/calibration/consents/${id}/withdraw`, manager);
    expect((await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: sequence() })).status).toBe(409);
  });

  test("anything beyond landmarks (e.g. image data) is rejected", async () => {
    const { id } = (await consent()).json();
    const withImage = { ...sequence(), video: "data:video/mp4;base64,AAAA" };
    expect((await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: withImage })).status).toBe(400);
    const frameWithImage = sequence();
    (frameWithImage.frames[0] as unknown as Record<string, unknown>).jpeg = "AAAA";
    expect((await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: frameWithImage })).status).toBe(400);
    const notCalibration = { ...sequence(), source: "synthetic" };
    expect((await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: notCalibration })).status).toBe(400);
  });

  test("stored encrypted and bound to tenant/recording; DB keeps only labels and a reference", async () => {
    const { id } = (await consent()).json();
    const seq = sequence();
    const r = await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: seq });
    expect(r.status).toBe(201);
    const recordingId = r.json().id;
    const [storageKey] = [...store.blobs.keys()];
    expect(storageKey).toBe(`${A}/${recordingId}.json.enc`);
    const blob = store.blobs.get(storageKey!)!;
    expect(Buffer.from(blob).toString("latin1")).not.toContain("formatVersion"); // not plaintext
    expect(JSON.parse(decryptBlob(blob, key, `${A}/${recordingId}`).toString())).toEqual(seq);
    expect(() => decryptBlob(blob, key, `${A}/other`)).toThrow(); // AAD binding

    const row = (await sql<{ labels_json: unknown; storage_ref: string; exercise_version: number }>`select labels_json, storage_ref, exercise_version from calibration_recordings`.execute(db)).rows[0]!;
    expect(row).toEqual({ labels_json: seq.labels, storage_ref: storageKey, exercise_version: 1 });
  });

  test("listing shows metadata only", async () => {
    const { id } = (await consent()).json();
    await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: sequence() });
    const list = (await api.call("GET", "/calibration/recordings", manager)).json();
    expect(list).toEqual([
      expect.objectContaining({ exerciseId: "squat", participantRef: "P-007", reps: 1 }),
    ]);
    expect(JSON.stringify(list)).not.toContain("image");
  });

  test("withdrawing consent deletes the recordings from the store and the database", async () => {
    const { id } = (await consent()).json();
    await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: sequence() });
    expect(store.blobs.size).toBe(1);
    expect((await api.call("POST", `/calibration/consents/${id}/withdraw`, manager)).status).toBe(204);
    expect(store.blobs.size).toBe(0);
    expect((await sql<{ n: number }>`select count(*)::int as n from calibration_recordings`.execute(db)).rows[0]!.n).toBe(0);
  });

  test("recordings older than 12 months are purged", async () => {
    const { id } = (await consent()).json();
    await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: sequence() });
    expect(await purgeExpiredRecordings(db, store, T0 + 300 * 24 * 3600_000)).toBe(0);
    expect(await purgeExpiredRecordings(db, store, T0 + 366 * 24 * 3600_000)).toBe(1);
    expect(store.blobs.size).toBe(0);
  });
});

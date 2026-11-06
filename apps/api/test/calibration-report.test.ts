import { fileURLToPath } from "node:url";
import { withParameter } from "@gymspot/engine";
import { squatSequence } from "@gymspot/engine/testing";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { MemoryBlobStore } from "../src/calibration/store";
import { buildReport, loadRecordingsFromDb, loadRulePacks, parseRecordingFile } from "../src/cli/calibration-report";
import { type Database, createDb } from "../src/db/db";
import { type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let store: MemoryBlobStore;
const key = new Uint8Array(32).fill(7);
const packs = loadRulePacks(fileURLToPath(new URL("../../../exercises", import.meta.url)));

const recording = () => ({
  ...squatSequence({
    view: "front",
    leadInMs: 5000,
    seed: 4,
    reps: [
      { kneeAngle: 90, label: { outcome: "valid", faults: [] } },
      { kneeAngle: 120, label: { outcome: "faulty", faults: ["insufficient_depth"] } },
    ],
  }),
  source: "calibration" as const,
});

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());
beforeEach(async () => {
  await seedTenants(db);
  store = new MemoryBlobStore();
  api = testApi(db, { calibrationKey: key }, store);
});

describe("calibration report tool (T5.3)", () => {
  test("decrypts uploaded recordings and reports pilot metrics", async () => {
    const manager = await api.staffToken("yonetici@a.test");
    const { id } = (await api.call("POST", "/calibration/consents", manager, { participantRef: "P-1", consentVersion: "v1", consentedAt: "2026-11-06T10:00:00.000Z" })).json();
    expect((await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: recording() })).status).toBe(201);

    const sequences = await loadRecordingsFromDb(db, store, key);
    expect(sequences).toHaveLength(1);
    const report = buildReport(packs, sequences);
    expect(report).toContain("## squat");
    expect(report).toContain("Sayım doğruluğu: 100.0%");
    expect(report).toContain("Yanlış alarm oranı: 0.0%");
    expect(report).toContain("| insufficient_depth | 1 | 0 | 0 |");
    expect(report).toContain("karşılanıyor");
  });

  test("the wrong key cannot read recordings", async () => {
    const manager = await api.staffToken("yonetici@a.test");
    const { id } = (await api.call("POST", "/calibration/consents", manager, { participantRef: "P-1", consentVersion: "v1", consentedAt: "2026-11-06T10:00:00.000Z" })).json();
    await api.call("POST", "/calibration/recordings", manager, { consentId: id, sequence: recording() });
    await expect(loadRecordingsFromDb(db, store, new Uint8Array(32).fill(1))).rejects.toThrow();
  });

  test("downloaded files and sweeps", () => {
    const file = JSON.stringify({ consent: { participantRef: "P-1" }, sequence: recording() });
    const seq = parseRecordingFile(file);
    const report = buildReport(packs, [seq], { exercise: "squat", sweep: "faults.insufficient_depth.threshold=100,130" });
    expect(report).toContain("### Tarama: `faults.insufficient_depth.threshold`");
    expect(report).toMatch(/\| 100 \| 100\.0% \| 0\.0% \| ✓ \|/);
    expect(report).toMatch(/\| 130 \| /);
    // a looser depth check misses the shallow rep: counting is unaffected (it was not valid anyway),
    // but the per-fault table shows the miss
    const loose = { ...packs, squat: withParameter(packs.squat, "faults.insufficient_depth.threshold", 130) };
    expect(buildReport(loose, [seq])).toContain("| insufficient_depth | 0 | 1 | 0 |");
    expect(buildReport(packs, [seq], { exercise: "pushup" })).not.toContain("## squat");
  });
});

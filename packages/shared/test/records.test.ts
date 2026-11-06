import { describe, expect, test } from "vitest";
import { RepEventRecordSchema, SessionBlockRecordSchema, SessionRecordSchema, SetRecordSchema } from "../src/index";

const now = new Date().toISOString();
const uuid = () => crypto.randomUUID();

const rep = { id: uuid(), setId: uuid(), repIndex: 0, outcome: "valid", durationMs: 1800, faults: [] };

const set = {
  id: uuid(),
  sessionBlockId: uuid(),
  setIndex: 0,
  plannedReps: 10,
  validReps: 8,
  faultyReps: 1,
  incompleteReps: 1,
  source: "camera",
  view: "front",
  belowTarget: false,
  startedAt: now,
  endedAt: now,
};

describe("ingestion records (specs/06)", () => {
  test("valid records parse", () => {
    expect(RepEventRecordSchema.safeParse(rep).success).toBe(true);
    expect(SetRecordSchema.safeParse(set).success).toBe(true);
    expect(
      SessionRecordSchema.safeParse({
        id: uuid(),
        memberId: "m1",
        memberProgramId: "p1",
        workoutDayIndex: 0,
        startedAt: now,
        status: "active",
      }).success,
    ).toBe(true);
    expect(
      SessionBlockRecordSchema.safeParse({
        id: uuid(),
        sessionId: uuid(),
        position: 0,
        exerciseId: "squat",
        exerciseVersion: 1,
        plannedSets: 3,
        executedByDeviceId: "d1",
        status: "delegated",
      }).success,
    ).toBe(true);
  });

  test("client-generated ids must be UUIDs (idempotency key)", () => {
    expect(RepEventRecordSchema.safeParse({ ...rep, id: "rep-1" }).success).toBe(false);
  });

  // specs/07: landmark/video data never leaves the device. Strict records make
  // it impossible to smuggle extra payload through the ingestion contract.
  test("extra fields such as landmarks are rejected", () => {
    expect(RepEventRecordSchema.safeParse({ ...rep, landmarks: [[0.1, 0.2]] }).success).toBe(false);
    expect(SetRecordSchema.safeParse({ ...set, frames: [] }).success).toBe(false);
  });

  test("timestamps must be ISO-8601 UTC", () => {
    expect(SetRecordSchema.safeParse({ ...set, startedAt: "06.11.2026 10:00" }).success).toBe(false);
  });

  test("manual sets have no view", () => {
    const { view: _view, ...manual } = set;
    expect(SetRecordSchema.safeParse({ ...manual, source: "manual" }).success).toBe(true);
    expect(SetRecordSchema.safeParse({ ...set, source: "manual" }).success).toBe(false);
  });
});

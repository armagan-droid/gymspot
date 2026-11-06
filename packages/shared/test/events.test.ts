import { describe, expect, test } from "vitest";
import { EngineEventSchema, ProgramInputSchema, UserActionKindSchema } from "../src/index";

describe("engine events (specs/03, 04)", () => {
  test("REP_COMPLETED carries outcome, fault ids and duration", () => {
    const e = { type: "REP_COMPLETED", outcome: "faulty", faults: ["knee_valgus"], durationMs: 1800 };
    expect(EngineEventSchema.safeParse(e).success).toBe(true);
    const { durationMs: _d, ...noDuration } = e;
    expect(EngineEventSchema.safeParse(noDuration).success).toBe(false);
  });

  test("unknown outcome is rejected", () => {
    const e = { type: "REP_COMPLETED", outcome: "partial", faults: [], durationMs: 1000 };
    expect(EngineEventSchema.safeParse(e).success).toBe(false);
  });

  test("payload-less events parse", () => {
    for (const type of ["REP_STARTED", "TRACKING_LOST", "TRACKING_RESTORED", "READY_POSE_HELD"]) {
      expect(EngineEventSchema.safeParse({ type }).success, type).toBe(true);
    }
  });

  test("SAFETY_PAUSE requires a fault id", () => {
    expect(EngineEventSchema.safeParse({ type: "SAFETY_PAUSE" }).success).toBe(false);
    expect(EngineEventSchema.safeParse({ type: "SAFETY_PAUSE", faultId: "knee_valgus" }).success).toBe(true);
  });

  test("FAULT_DETECTED requires a fault id", () => {
    expect(EngineEventSchema.safeParse({ type: "FAULT_DETECTED" }).success).toBe(false);
    expect(EngineEventSchema.safeParse({ type: "FAULT_DETECTED", faultId: "hip_sag" }).success).toBe(true);
  });
});

describe("program inputs (specs/03)", () => {
  test("all user action kinds from the spec are accepted", () => {
    const kinds = ["START", "READY", "PAUSE", "RESUME", "END_SET", "CONTINUE_SET", "SKIP_BLOCK", "UNDO_SKIP", "ABORT"];
    expect(UserActionKindSchema.options).toEqual(kinds);
    for (const kind of kinds) {
      expect(ProgramInputSchema.safeParse({ type: "USER_ACTION", kind }).success, kind).toBe(true);
    }
  });

  test("TICK requires now", () => {
    expect(ProgramInputSchema.safeParse({ type: "TICK" }).success).toBe(false);
    expect(ProgramInputSchema.safeParse({ type: "TICK", now: 1000 }).success).toBe(true);
  });

  test("HANDOFF_ACCEPTED requires a cursor", () => {
    const cursor = { sessionId: crypto.randomUUID(), blockIndex: 1, setIndex: 0 };
    expect(ProgramInputSchema.safeParse({ type: "HANDOFF_ACCEPTED", cursor }).success).toBe(true);
    expect(ProgramInputSchema.safeParse({ type: "HANDOFF_ACCEPTED" }).success).toBe(false);
  });

  test("engine events are program inputs", () => {
    expect(ProgramInputSchema.safeParse({ type: "REP_STARTED" }).success).toBe(true);
  });
});

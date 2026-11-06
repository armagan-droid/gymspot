import { describe, expect, test } from "vitest";
import { SessionCursorSchema, WorkoutSchema } from "../src/index";

const block = {
  exerciseId: "squat",
  exerciseVersion: 1,
  sets: 3,
  reps: 10,
  restSec: 90,
  mode: "strict",
};

const workout = { id: "w1", name: "Gün A", blocks: [block] };

describe("Workout (specs/03)", () => {
  test("valid workout parses", () => {
    expect(WorkoutSchema.safeParse(workout).success).toBe(true);
  });

  test("optional stationHint is accepted", () => {
    const w = { ...workout, blocks: [{ ...block, stationHint: "Squat Rafı 2" }] };
    expect(WorkoutSchema.safeParse(w).success).toBe(true);
  });

  test("a block needs exactly one of reps or durationSec", () => {
    const both = { ...workout, blocks: [{ ...block, durationSec: 30 }] };
    expect(WorkoutSchema.safeParse(both).success).toBe(false);
    const { reps: _reps, ...noTarget } = block;
    expect(WorkoutSchema.safeParse({ ...workout, blocks: [noTarget] }).success).toBe(false);
  });

  test("sets must be at least 1", () => {
    const w = { ...workout, blocks: [{ ...block, sets: 0 }] };
    expect(WorkoutSchema.safeParse(w).success).toBe(false);
  });

  test("mode must be strict or lenient", () => {
    const w = { ...workout, blocks: [{ ...block, mode: "soft" }] };
    expect(WorkoutSchema.safeParse(w).success).toBe(false);
  });

  test("workout needs at least one block", () => {
    expect(WorkoutSchema.safeParse({ ...workout, blocks: [] }).success).toBe(false);
  });

  test("unknown fields are rejected", () => {
    const w = { ...workout, blocks: [{ ...block, weightKg: 20 }] };
    expect(WorkoutSchema.safeParse(w).success).toBe(false);
  });
});

describe("SessionCursor (specs/03)", () => {
  test("valid cursor parses", () => {
    const c = { sessionId: crypto.randomUUID(), blockIndex: 0, setIndex: 2 };
    expect(SessionCursorSchema.safeParse(c).success).toBe(true);
  });

  test("negative indexes are rejected", () => {
    const c = { sessionId: crypto.randomUUID(), blockIndex: -1, setIndex: 0 };
    expect(SessionCursorSchema.safeParse(c).success).toBe(false);
  });
});

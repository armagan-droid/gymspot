import { z } from "zod";
import { IdentifierSchema } from "./common";
import { SessionCursorSchema } from "./workout";

// specs/03-program-engine.md "Girdi / Çıktı"

export const RepOutcomeSchema = z.enum(["valid", "faulty", "incomplete"]);
export type RepOutcome = z.infer<typeof RepOutcomeSchema>;

/** Events produced by the rep/fault engine (specs/04). */
const engineEventOptions = [
  z.strictObject({ type: z.literal("REP_STARTED") }),
  z.strictObject({
    type: z.literal("REP_COMPLETED"),
    outcome: RepOutcomeSchema,
    faults: z.array(IdentifierSchema),
    durationMs: z.int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("FAULT_DETECTED"), faultId: IdentifierSchema }),
  z.strictObject({ type: z.literal("TRACKING_LOST") }),
  z.strictObject({ type: z.literal("TRACKING_RESTORED") }),
  z.strictObject({ type: z.literal("READY_POSE_HELD") }),
] as const;

export const EngineEventSchema = z.discriminatedUnion("type", [...engineEventOptions]);
export type EngineEvent = z.infer<typeof EngineEventSchema>;

export const UserActionKindSchema = z.enum([
  "START",
  "READY",
  "PAUSE",
  "RESUME",
  "END_SET",
  "CONTINUE_SET",
  "SKIP_BLOCK",
  "UNDO_SKIP",
  "ABORT",
]);
export type UserActionKind = z.infer<typeof UserActionKindSchema>;

/** Everything the program state machine consumes. */
export const ProgramInputSchema = z.discriminatedUnion("type", [
  ...engineEventOptions,
  z.strictObject({ type: z.literal("USER_ACTION"), kind: UserActionKindSchema }),
  z.strictObject({ type: z.literal("HANDOFF_ACCEPTED"), cursor: SessionCursorSchema }),
  z.strictObject({ type: z.literal("HANDOFF_RETURNED") }),
  z.strictObject({ type: z.literal("TICK"), now: z.number().nonnegative() }),
]);
export type ProgramInput = z.infer<typeof ProgramInputSchema>;

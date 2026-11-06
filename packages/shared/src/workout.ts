import { z } from "zod";
import { IdentifierSchema } from "./common";

// specs/03-program-engine.md "Veri"

export const BlockSchema = z
  .strictObject({
    exerciseId: IdentifierSchema,
    exerciseVersion: z.int().min(1),
    sets: z.int().min(1),
    reps: z.int().min(1).optional(),
    durationSec: z.int().min(1).optional(),
    restSec: z.int().nonnegative(),
    stationHint: z.string().min(1).optional(),
    mode: z.enum(["strict", "lenient"]),
  })
  .refine((b) => (b.reps === undefined) !== (b.durationSec === undefined), "exactly one of reps or durationSec is required");
export type Block = z.infer<typeof BlockSchema>;

export const WorkoutSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  blocks: z.array(BlockSchema).min(1),
});
export type Workout = z.infer<typeof WorkoutSchema>;

export const SessionCursorSchema = z.strictObject({
  sessionId: z.uuid(),
  blockIndex: z.int().nonnegative(),
  setIndex: z.int().nonnegative(),
});
export type SessionCursor = z.infer<typeof SessionCursorSchema>;

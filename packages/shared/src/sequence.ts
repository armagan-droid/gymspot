import { z } from "zod";
import { IdentifierSchema } from "./common";
import { RepOutcomeSchema } from "./events";
import { FrameSchema } from "./frame";

// Landmark sequence used by test fixtures and calibration recordings (specs/04 "fixture formatı").

export const RepLabelSchema = z.strictObject({
  outcome: RepOutcomeSchema,
  faults: z.array(IdentifierSchema),
});
export type RepLabel = z.infer<typeof RepLabelSchema>;

export const LandmarkSequenceSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    exerciseId: IdentifierSchema,
    source: z.enum(["synthetic", "calibration", "team"]),
    view: z.enum(["front", "side"]),
    fps: z.number().positive(),
    labels: z.strictObject({ reps: z.array(RepLabelSchema) }).optional(),
    frames: z.array(FrameSchema).min(1),
  })
  .refine((s) => s.frames.every((f, i) => i === 0 || f.t > s.frames[i - 1]!.t), {
    path: ["frames"],
    message: "frame timestamps must be strictly increasing",
  });
export type LandmarkSequence = z.infer<typeof LandmarkSequenceSchema>;

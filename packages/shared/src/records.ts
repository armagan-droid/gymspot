import { z } from "zod";
import { IdentifierSchema, ViewSchema } from "./common";
import { RepOutcomeSchema } from "./events";

// Client → API ingestion records (specs/06 "seans"). Ids are client-generated
// UUIDs and double as idempotency keys. tenant_id is never sent by the client;
// the API derives it from the authenticated principal. Objects are strict so
// no extra payload (e.g. landmarks) can pass through (specs/07).

const timestamp = z.iso.datetime();

export const SessionRecordSchema = z.strictObject({
  id: z.uuid(),
  memberId: z.string().min(1),
  memberProgramId: z.string().min(1),
  workoutDayIndex: z.int().nonnegative(),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  status: z.enum(["active", "paused", "done", "abandoned", "aborted"]),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const SessionBlockRecordSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  position: z.int().nonnegative(),
  exerciseId: IdentifierSchema,
  exerciseVersion: z.int().min(1),
  plannedSets: z.int().min(1),
  executedByDeviceId: z.string().min(1),
  stationId: z.string().min(1).optional(),
  status: z.enum(["done", "skipped", "partial", "delegated"]),
});
export type SessionBlockRecord = z.infer<typeof SessionBlockRecordSchema>;

export const SetRecordSchema = z
  .strictObject({
    id: z.uuid(),
    sessionBlockId: z.uuid(),
    setIndex: z.int().nonnegative(),
    plannedReps: z.int().min(1).optional(),
    validReps: z.int().nonnegative(),
    faultyReps: z.int().nonnegative(),
    incompleteReps: z.int().nonnegative(),
    source: z.enum(["camera", "manual"]),
    view: ViewSchema.optional(),
    belowTarget: z.boolean(),
    startedAt: timestamp,
    endedAt: timestamp,
  })
  .refine((s) => s.source === "camera" || s.view === undefined, {
    path: ["view"],
    message: "manual sets have no camera view",
  });
export type SetRecord = z.infer<typeof SetRecordSchema>;

export const RepEventRecordSchema = z.strictObject({
  id: z.uuid(),
  setId: z.uuid(),
  repIndex: z.int().nonnegative(),
  outcome: RepOutcomeSchema,
  durationMs: z.int().nonnegative(),
  faults: z.array(IdentifierSchema),
});
export type RepEventRecord = z.infer<typeof RepEventRecordSchema>;

/** A record as queued by clients and sent to POST /ingest (strict: no extra payload, specs/07). */
export const PersistRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session"), data: SessionRecordSchema }),
  z.strictObject({ kind: z.literal("session_block"), data: SessionBlockRecordSchema }),
  z.strictObject({ kind: z.literal("set"), data: SetRecordSchema }),
  z.strictObject({ kind: z.literal("rep"), data: RepEventRecordSchema }),
]);
export type PersistRecordInput = z.infer<typeof PersistRecordSchema>;

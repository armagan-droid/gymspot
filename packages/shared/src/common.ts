import { z } from "zod";

/** Machine identifier used for exercise, metric and fault ids. */
export const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "must be snake_case starting with a letter");

/** User-facing text; Turkish is the default language, English the second (CLAUDE.md "Dil"). */
export const LocalizedTextSchema = z.strictObject({
  tr: z.string().min(1),
  en: z.string().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** Camera view detected by the engine (specs/04 "Görünüm"). */
export const ViewSchema = z.enum(["front", "side", "ambiguous"]);
export type View = z.infer<typeof ViewSchema>;

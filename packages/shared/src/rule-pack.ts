import { z } from "zod";
import { IdentifierSchema, LocalizedTextSchema } from "./common";
import { LandmarkRefSchema } from "./landmarks";

// Rule pack schema — specs/04-exercise-rules.md. Expressions (fault checks,
// readyPose) are only shape-checked here; their grammar and metric references
// are validated by the expression parser (T1.1).

export const CHECK_POSITIONS = ["at_turn", "at_start", "during_rep"] as const;
export type CheckPosition = (typeof CHECK_POSITIONS)[number];

export const EXPRESSION_FUNCTIONS = ["abs", "avg", "min", "max"] as const;

export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "not",
  "for",
  "ms",
  ...EXPRESSION_FUNCTIONS,
  ...CHECK_POSITIONS,
]);

export const DEFAULT_MIN_VISIBILITY = 0.6;
export const DEFAULT_COOLDOWN_MS = 4000;
export const DEFAULT_MIN_CONSECUTIVE_REPS = 1;
export const DEFAULT_HOLD_MS = 150;

const lm = LandmarkRefSchema;
const metric = IdentifierSchema;

/** Closed list of metric functions (specs/04 "Metrik fonksiyonları"). */
export const MetricDefinitionSchema = z.union([
  z.strictObject({ angle: z.tuple([lm, lm, lm]) }),
  z.strictObject({ avg: z.tuple([metric, metric]) }),
  z.strictObject({ absDiff: z.tuple([metric, metric]) }),
  z.strictObject({ max: z.tuple([metric, metric]) }),
  z.strictObject({ diffY: z.tuple([lm, lm]) }),
  z.strictObject({ angleFromVertical: z.tuple([lm, lm]) }),
  z.strictObject({ kneeInwardRatio: z.tuple([lm, lm, lm]) }),
  z.strictObject({ signedOffset: z.tuple([lm, lm, lm]) }),
  z.strictObject({ lateralLean: z.tuple([lm, lm]) }),
  z.strictObject({ chainHeight: z.array(lm).min(2).max(6) }),
]);
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

/** Metric names a definition depends on (empty for landmark-based functions). */
export function metricDependencies(def: MetricDefinition): string[] {
  if ("avg" in def) return [...def.avg];
  if ("absDiff" in def) return [...def.absDiff];
  if ("max" in def) return [...def.max];
  return [];
}

const CameraViewSchema = z.enum(["front", "side"]);

const RepZoneSchema = z.strictObject({ enter: z.number(), exit: z.number() });

const checkPattern = new RegExp(`^(${CHECK_POSITIONS.join("|")}):\\s*\\S`);

export function checkPosition(check: string): CheckPosition {
  return check.slice(0, check.indexOf(":")) as CheckPosition;
}

const FaultSchema = z
  .strictObject({
    id: IdentifierSchema,
    /** Display name of the form check (A3 "active checks"). */
    name: LocalizedTextSchema,
    severity: z.enum(["minor", "major"]),
    check: z.string().regex(checkPattern, `must start with one of ${CHECK_POSITIONS.join(", ")} followed by ':'`),
    views: z.array(CameraViewSchema).min(1).optional(),
    cue: LocalizedTextSchema,
    affectsValidity: z.boolean(),
    cooldownMs: z.int().nonnegative().default(DEFAULT_COOLDOWN_MS),
    minConsecutiveReps: z.int().min(1).default(DEFAULT_MIN_CONSECUTIVE_REPS),
    holdMs: z.int().positive().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.holdMs !== undefined && checkPosition(f.check) !== "during_rep") {
      ctx.addIssue({ code: "custom", path: ["holdMs"], message: "holdMs is only allowed on during_rep checks" });
    }
  })
  .transform((f) =>
    f.holdMs === undefined && checkPosition(f.check) === "during_rep" ? { ...f, holdMs: DEFAULT_HOLD_MS } : f,
  );

const uniqueViews = z
  .array(CameraViewSchema)
  .min(1)
  .refine((v) => new Set(v).size === v.length, "views must be unique");

export const RulePackSchema = z
  .strictObject({
    id: IdentifierSchema,
    version: z.int().min(1),
    status: z.enum(["draft", "calibrated"]),
    name: LocalizedTextSchema,
    type: z.enum(["reps", "hold"]),
    camera: z.strictObject({
      views: uniqueViews,
      minVisibleLandmarks: z.array(LandmarkRefSchema).min(1),
      minVisibility: z.number().min(0).max(1).default(DEFAULT_MIN_VISIBILITY),
      /** Body orientation for the A3 target silhouette (specs/08). */
      posture: z.enum(["standing", "horizontal"]).default("standing"),
      setupHint: LocalizedTextSchema,
    }),
    metrics: z.record(IdentifierSchema, MetricDefinitionSchema),
    rep: z.strictObject({
      metric: IdentifierSchema,
      start: RepZoneSchema,
      target: RepZoneSchema,
      attemptMinExcursion: z.number().positive(),
      minDurationMs: z.int().positive(),
      maxDurationMs: z.int().positive(),
    }),
    readyPose: z.string().regex(/^\S.*\sfor\s+\d+ms$/, "must be '<expression> for <n>ms'"),
    faults: z.array(FaultSchema),
    smoothing: z.strictObject({
      method: z.literal("one_euro"),
      minCutoff: z.number().positive(),
      beta: z.number().nonnegative(),
    }),
    /** A5 drawing for head-movement drills (specs/04 "Eskiv", 08); visual only. */
    overlay: z
      .strictObject({
        headTarget: z
          .strictObject({ lateral: z.number().positive().optional(), height: z.number().positive().optional() })
          .refine((h) => h.lateral !== undefined || h.height !== undefined, "headTarget needs lateral or height"),
      })
      .optional(),
  })
  .superRefine((pack, ctx) => {
    if (pack.type === "hold") {
      ctx.addIssue({ code: "custom", path: ["type"], message: "hold rule packs are not supported in the MVP" });
    }

    // Metric names, references and cycles.
    const metrics = pack.metrics;
    for (const [name, def] of Object.entries(metrics)) {
      if (RESERVED_WORDS.has(name)) {
        ctx.addIssue({ code: "custom", path: ["metrics", name], message: `'${name}' is a reserved expression word` });
      }
      for (const dep of metricDependencies(def)) {
        if (!(dep in metrics)) {
          ctx.addIssue({ code: "custom", path: ["metrics", name], message: `references undefined metric '${dep}'` });
        }
      }
    }
    const cycle = findMetricCycle(metrics);
    if (cycle) {
      ctx.addIssue({ code: "custom", path: ["metrics", cycle[0]!], message: `metric cycle: ${cycle.join(" -> ")}` });
    }

    // Rep zones (specs/04 "Tekrar algılama").
    const { rep } = pack;
    if (!(rep.metric in metrics)) {
      ctx.addIssue({ code: "custom", path: ["rep", "metric"], message: `undefined metric '${rep.metric}'` });
    }
    const { start, target } = rep;
    if (start.enter === target.enter) {
      ctx.addIssue({ code: "custom", path: ["rep"], message: "start.enter and target.enter must differ" });
    } else {
      // s = +1 for decreasing movements (squat), -1 for increasing (press); flips every comparison.
      const s = start.enter > target.enter ? 1 : -1;
      if (!(s * start.exit < s * start.enter)) {
        ctx.addIssue({ code: "custom", path: ["rep", "start"], message: "exit must be inside the movement range relative to enter" });
      }
      if (!(s * target.exit > s * target.enter)) {
        ctx.addIssue({ code: "custom", path: ["rep", "target"], message: "exit must be inside the movement range relative to enter" });
      }
      if (!(s * target.exit < s * start.exit)) {
        ctx.addIssue({ code: "custom", path: ["rep"], message: "start and target zones overlap" });
      }
    }
    if (rep.minDurationMs >= rep.maxDurationMs) {
      ctx.addIssue({ code: "custom", path: ["rep"], message: "minDurationMs must be below maxDurationMs" });
    }

    // Faults.
    const seen = new Set<string>();
    pack.faults.forEach((fault, i) => {
      if (seen.has(fault.id)) {
        ctx.addIssue({ code: "custom", path: ["faults", i, "id"], message: `duplicate fault id '${fault.id}'` });
      }
      seen.add(fault.id);
      const outside = fault.views?.filter((v) => !pack.camera.views.includes(v)) ?? [];
      if (outside.length > 0) {
        ctx.addIssue({ code: "custom", path: ["faults", i, "views"], message: `not in camera.views: ${outside.join(", ")}` });
      }
    });
  });

export type RulePack = z.output<typeof RulePackSchema>;
export type RulePackInput = z.input<typeof RulePackSchema>;
export type Fault = RulePack["faults"][number];

export function parseRulePack(input: unknown): RulePack {
  return RulePackSchema.parse(input);
}

export function safeParseRulePack(input: unknown) {
  return RulePackSchema.safeParse(input);
}

/** Returns one dependency cycle (first name repeated at the end), or null. */
function findMetricCycle(metrics: Record<string, MetricDefinition>): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (name: string): string[] | null => {
    if (state.get(name) === "done") return null;
    if (state.get(name) === "visiting") return [...stack.slice(stack.indexOf(name)), name];
    const def = metrics[name];
    if (!def) return null;
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of metricDependencies(def)) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, "done");
    return null;
  };

  for (const name of Object.keys(metrics)) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

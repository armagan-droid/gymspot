import {
  type Edge,
  type ExerciseSetup,
  type MetricComputer,
  SETUP_CHECKS,
  chainHeight,
  createMetricComputer,
  problemEdges,
  resolveLandmark,
} from "@gymspot/engine";
import { type Frame, LANDMARK_NAMES, type RulePack } from "@gymspot/shared";

// Skeleton and guide frame over the camera preview (specs/08 A3, A5).
// Drawn on a local canvas only; nothing is stored or sent (specs/07).

/** Body connections between MediaPipe Pose landmark indices (face omitted). */
export const POSE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
const BODY_POINTS = [0, ...new Set(POSE_CONNECTIONS.flat())];

export type PointState = "ok" | "low" | "missing";

export interface OverlayOptions {
  minVisibility: number;
  /** Landmarks that must be visible; hidden ones are shown as missing (A3). */
  required?: readonly number[];
  /** A3 guide frame: inset by the edge margin, green when ready. */
  guide?: { margin: number; ready: boolean };
  /** A3 target silhouette: where and how big the person should be. */
  target?: "standing" | "horizontal";
  /** A3 edges the body sticks out of (red bands). */
  edges?: readonly Edge[];
  /** A5 joints of the fault being cued (red). */
  highlight?: readonly number[];
  /** A5 head target of head-movement drills (specs/08). */
  headTarget?: HeadTarget | null;
  /** Skeleton switched off: only the guides are drawn. */
  hideSkeleton?: boolean;
}

type P = { x: number; y: number };

/** Head target in normalized image coordinates; radius is a fraction of the picture height. */
export interface HeadTarget {
  center: P;
  radius: number;
  head: P;
  /** Duck threshold line (image y), when the drill has one. */
  duckY?: number;
  /** The head is past the counting threshold. */
  hit: boolean;
}

const NOSE = 0;
const HIPS = [23, 24] as const;
const ANKLES = [27, 28] as const;
const CHAINS = [
  [0, 11, 23, 25, 27],
  [0, 12, 24, 26, 28],
] as const;
const HOME_SMOOTHING = 0.2;

/**
 * Follows where the head rests between reps (EMA while the rep metric is in
 * its start zone) and draws the drill's thresholds around it: the circle's
 * radius is the lateral slip threshold, the line below it the duck threshold.
 * Visual only; counting is the rep rule's (specs/04 "Eskiv", 08 A5).
 */
export class HeadTargetTracker {
  private readonly metrics: MetricComputer;
  private home: { nose: P; hip: P; foot: P | null; chain: number } | null = null;

  constructor(private readonly pack: RulePack) {
    this.metrics = createMetricComputer(pack.metrics);
  }

  static for(pack: RulePack | undefined): HeadTargetTracker | null {
    return pack?.overlay?.headTarget ? new HeadTargetTracker(pack) : null;
  }

  /** `aspect` = picture width / height, so the circle stays round on screen. */
  update(frame: Frame | null, aspect: number): HeadTarget | null {
    if (!frame) return null;
    const { rep } = this.pack;
    const target = this.pack.overlay!.headTarget!;
    const value = this.metrics.compute(frame, "left")[rep.metric];
    if (value === undefined || Number.isNaN(value)) return null;
    const down = rep.start.enter > rep.target.enter; // decreasing metric
    const atHome = down ? value >= rep.start.enter : value <= rep.start.enter;
    const hit = down ? value <= rep.target.enter : value >= rep.target.enter;
    const img = frame.image;
    const mid = (a: number, b: number): P => ({ x: (img[a]!.x + img[b]!.x) / 2, y: (img[a]!.y + img[b]!.y) / 2 });
    const ankles = ANKLES.every((i) => img[i]!.visibility >= this.pack.camera.minVisibility) ? mid(...ANKLES) : null;
    if (atHome || !this.home) {
      const chain = (chainHeight(CHAINS[0].map((i) => frame.world[i]!)) + chainHeight(CHAINS[1].map((i) => frame.world[i]!))) / 2;
      const now = { nose: { x: img[NOSE]!.x, y: img[NOSE]!.y }, hip: mid(...HIPS), foot: ankles, chain };
      const h = this.home;
      const k = h ? HOME_SMOOTHING : 1;
      const ema = (a: P, b: P): P => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      this.home = h
        ? { nose: ema(h.nose, now.nose), hip: ema(h.hip, now.hip), foot: now.foot && (h.foot ? ema(h.foot, now.foot) : now.foot), chain: h.chain + (now.chain - h.chain) * k }
        : now;
    }
    const h = this.home!;
    let duckY: number | undefined;
    if (target.height !== undefined && h.foot && h.chain > 0) {
      duckY = h.foot.y - (target.height / h.chain) * (h.foot.y - h.nose.y);
    }
    // lateralLean ≈ sideways offset / hip–nose length, so the slip radius is that length times the threshold
    const hipToNose = Math.hypot((h.nose.x - h.hip.x) * aspect, h.nose.y - h.hip.y);
    const radius = target.lateral !== undefined ? target.lateral * hipToNose : duckY !== undefined ? duckY - h.nose.y : 0;
    if (!(radius > 0)) return null;
    return { center: h.nose, radius, head: { x: img[NOSE]!.x, y: img[NOSE]!.y }, ...(duckY !== undefined && { duckY }), hit };
  }
}

/**
 * A5 tracking loss: the A3 setup guide comes back (target silhouette, guide
 * frame, red bands at the edges the body sticks out of) so the member sees
 * where to stand (specs/08).
 */
export function trackingGuide(pack: RulePack, setup: ExerciseSetup, frame: Frame | null): OverlayOptions {
  const m = SETUP_CHECKS.edgeMargin;
  const required = pack.camera.minVisibleLandmarks.map((r) => LANDMARK_NAMES.indexOf(resolveLandmark(r, setup.nearSide)));
  return {
    minVisibility: pack.camera.minVisibility,
    required,
    guide: { margin: m, ready: false },
    target: pack.camera.posture,
    edges: problemEdges(frame ?? undefined, required, m),
  };
}

export interface OverlayShapes {
  lines: { a: { x: number; y: number }; b: { x: number; y: number } }[];
  points: { x: number; y: number; state: PointState }[];
}

/** What to draw for one frame, in normalized [0,1] image coordinates. */
export function overlayShapes(frame: Frame | null, o: OverlayOptions): OverlayShapes {
  if (!frame) return { lines: [], points: [] };
  const img = frame.image;
  const required = new Set(o.required ?? []);
  const visible = (i: number) => img[i]!.visibility >= o.minVisibility;
  return {
    lines: POSE_CONNECTIONS.filter(([a, b]) => visible(a) && visible(b)).map(([a, b]) => ({ a: img[a]!, b: img[b]! })),
    points: [...new Set([...BODY_POINTS, ...required])].flatMap((i) => {
      const p = img[i]!;
      const state: PointState = visible(i) ? "ok" : required.has(i) ? "missing" : "low";
      return state === "low" ? [] : [{ x: p.x, y: p.y, state }];
    }),
  };
}

const COLORS = {
  line: "rgba(255,255,255,0.85)",
  ok: "#4ade80",
  missing: "#ef4444",
  ready: "#4ade80",
  wait: "#facc15",
  target: "rgba(255,255,255,0.55)",
  band: "rgba(239,68,68,0.45)",
};

type Poly = readonly (readonly [number, number])[];
interface Silhouette {
  lines: readonly Poly[];
  head: { x: number; y: number; r: number };
}
/** Target silhouettes in a unit-width box (x right, y down). */
const SILHOUETTES: Record<"standing" | "horizontal", Silhouette> = {
  // front-facing figure, 1 tall
  standing: {
    lines: [
      [[0.5, 0.13], [0.5, 0.52]],
      [[0.36, 0.19], [0.64, 0.19]],
      [[0.36, 0.19], [0.3, 0.36], [0.28, 0.52]],
      [[0.64, 0.19], [0.7, 0.36], [0.72, 0.52]],
      [[0.42, 0.52], [0.58, 0.52]],
      [[0.42, 0.52], [0.4, 0.76], [0.39, 1]],
      [[0.58, 0.52], [0.6, 0.76], [0.61, 1]],
    ],
    head: { x: 0.5, y: 0.065, r: 0.065 },
  },
  // side view plank, floor at y = 0.33
  horizontal: {
    lines: [
      [[0.15, 0.12], [0.55, 0.17], [0.75, 0.205], [0.95, 0.24], [0.98, 0.33]],
      [[0.15, 0.12], [0.15, 0.22], [0.16, 0.33]],
    ],
    head: { x: 0.07, y: 0.09, r: 0.045 },
  },
};

/** Paints the overlay onto a canvas laid over a `object-fit: contain` video. */
export function paintOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, frame: Frame | null, o: OverlayOptions): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return; // no picture yet
  const dpr = globalThis.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // the picture's rectangle inside the element (letterboxed by object-fit: contain)
  const k = Math.min(cw / vw, ch / vh);
  const w = vw * k;
  const h = vh * k;
  const ox = (cw - w) / 2;
  const oy = (ch - h) / 2;
  const at = (p: { x: number; y: number }) => [ox + p.x * w, oy + p.y * h] as const;

  if (o.edges?.length) {
    const t = Math.max(20, 0.1 * Math.min(w, h));
    ctx.fillStyle = COLORS.band;
    for (const e of o.edges) {
      if (e === "top") ctx.fillRect(ox, oy, w, t);
      if (e === "bottom") ctx.fillRect(ox, oy + h - t, w, t);
      if (e === "left") ctx.fillRect(ox, oy, t, h);
      if (e === "right") ctx.fillRect(ox + w - t, oy, t, h);
    }
  }
  if (o.target) paintTarget(ctx, o.target, ox, oy, w, h, o.target === "horizontal" && frame !== null && facesRight(frame));
  if (o.guide) {
    const m = o.guide.margin;
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = o.guide.ready ? COLORS.ready : COLORS.wait;
    ctx.strokeRect(ox + m * w, oy + m * h, w * (1 - 2 * m), h * (1 - 2 * m));
    ctx.setLineDash([]);
  }
  if (o.headTarget) paintHeadTarget(ctx, o.headTarget, at, h);
  if (o.hideSkeleton) return;
  const shapes = overlayShapes(frame, o);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.line;
  for (const { a, b } of shapes.lines) {
    ctx.beginPath();
    ctx.moveTo(...at(a));
    ctx.lineTo(...at(b));
    ctx.stroke();
  }
  for (const p of shapes.points) {
    const [x, y] = at(p);
    ctx.beginPath();
    ctx.arc(x, y, p.state === "missing" ? 8 : 5, 0, Math.PI * 2);
    ctx.fillStyle = p.state === "missing" ? COLORS.missing : COLORS.ok;
    ctx.fill();
  }
  if (frame && o.highlight?.length) {
    const hi = new Set(o.highlight);
    ctx.strokeStyle = COLORS.missing;
    ctx.lineWidth = 7;
    for (const [a, b] of POSE_CONNECTIONS) {
      if (!hi.has(a) || !hi.has(b)) continue;
      ctx.beginPath();
      ctx.moveTo(...at(frame.image[a]!));
      ctx.lineTo(...at(frame.image[b]!));
      ctx.stroke();
    }
    for (const i of hi) {
      const [x, y] = at(frame.image[i]!);
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.missing;
      ctx.fill();
    }
  }
}

/** Crosshair circle around the resting head, the duck line below it, and the head itself. */
function paintHeadTarget(ctx: CanvasRenderingContext2D, t: HeadTarget, at: (p: P) => readonly [number, number], h: number): void {
  const [cx, cy] = at(t.center);
  const r = t.radius * h;
  const color = t.hit ? COLORS.ready : COLORS.line;
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 1.4 * r, cy);
  ctx.lineTo(cx + 1.4 * r, cy);
  ctx.moveTo(cx, cy - 1.4 * r);
  ctx.lineTo(cx, cy + 1.4 * r);
  ctx.stroke();
  if (t.duckY !== undefined) {
    const [, y] = at({ x: t.center.x, y: t.duckY });
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 1.6 * r, y);
    ctx.lineTo(cx + 1.6 * r, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const [hx, hy] = at(t.head);
  ctx.beginPath();
  ctx.arc(hx, hy, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Head to the right of the hips (someone lying the other way round). */
function facesRight(frame: Frame): boolean {
  const img = frame.image;
  return img[0]!.x > (img[23]!.x + img[24]!.x) / 2;
}

/** Dashed figure: 80 % of the picture height (standing) or 85 % of its width lying on the floor (horizontal). */
function paintTarget(
  ctx: CanvasRenderingContext2D,
  posture: "standing" | "horizontal",
  ox: number,
  oy: number,
  w: number,
  h: number,
  mirror: boolean,
): void {
  const sil = SILHOUETTES[posture];
  const size = posture === "standing" ? 0.8 * h : Math.min(0.85 * w, (0.85 * h) / 0.33);
  const left = ox + (w - size) / 2;
  const top = posture === "standing" ? oy + 0.1 * h : oy + 0.92 * h - 0.33 * size;
  const at = (x: number, y: number) => [left + (mirror ? 1 - x : x) * size, top + y * size] as const;
  ctx.save();
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = Math.max(3, size * 0.015);
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.target;
  for (const line of sil.lines) {
    ctx.beginPath();
    line.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(...at(x, y)) : ctx.lineTo(...at(x, y))));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(...at(sil.head.x, sil.head.y), sil.head.r * size, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Clears the canvas (e.g. when the skeleton is switched off). */
export function clearOverlay(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

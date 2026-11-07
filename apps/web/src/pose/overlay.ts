import type { Frame } from "@gymspot/shared";

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

const COLORS = { line: "rgba(255,255,255,0.85)", ok: "#4ade80", missing: "#ef4444", ready: "#4ade80", wait: "#facc15" };

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

  if (o.guide) {
    const m = o.guide.margin;
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = o.guide.ready ? COLORS.ready : COLORS.wait;
    ctx.strokeRect(ox + m * w, oy + m * h, w * (1 - 2 * m), h * (1 - 2 * m));
    ctx.setLineDash([]);
  }
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
}

/** Clears the canvas (e.g. when the skeleton is switched off). */
export function clearOverlay(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

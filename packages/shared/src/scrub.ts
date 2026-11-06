// Error report scrubbing — specs/07 "Hata izleme servisine giden olaylarda PII,
// landmark ve görüntü bulunmaz", specs/02 "Gözlemlenebilirlik". Allow-list based.

export interface ErrorEvent {
  message: string;
  stack?: string;
  tags?: Partial<Record<(typeof ALLOWED_TAGS)[number], string>>;
  /** Scalars only (status names, counts); anything else is dropped. */
  context?: Record<string, string | number | boolean>;
}

const ALLOWED_TAGS = ["route", "release", "deviceKind", "screen", "status", "exerciseId", "browser"] as const;
const MAX_TEXT = 2000;
const MAX_STACK = 4000;
const MAX_CONTEXT_KEYS = 20;

const PATTERNS: [RegExp, string][] = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  // <tenant uuid>.<opaque secret> (refresh, magic link, device tokens)
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[\w-]{16,}/gi, "[token]"],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]"],
  // international or local phone numbers with optional separators
  [/(?<![\w-])\+?\d[\d\s().-]{8,}\d(?![\w-])/g, "[phone]"],
];

export function scrubText(text: string, max = MAX_TEXT): string {
  let out = String(text);
  for (const [re, label] of PATTERNS) out = out.replace(re, label);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Builds a safe event from anything an error handler might collect. */
export function scrubErrorEvent(input: Record<string, unknown>): ErrorEvent {
  const event: ErrorEvent = { message: scrubText(typeof input.message === "string" && input.message ? input.message : "(no message)") };
  if (typeof input.stack === "string") event.stack = scrubText(input.stack, MAX_STACK);

  if (input.tags && typeof input.tags === "object") {
    const tags: ErrorEvent["tags"] = {};
    for (const key of ALLOWED_TAGS) {
      const v = (input.tags as Record<string, unknown>)[key];
      if (typeof v === "string") tags[key] = scrubText(v, 200);
    }
    if (Object.keys(tags).length > 0) event.tags = tags;
  }

  if (input.context && typeof input.context === "object") {
    const context: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(input.context as Record<string, unknown>)) {
      if (Object.keys(context).length >= MAX_CONTEXT_KEYS) break;
      if (typeof v === "number" || typeof v === "boolean") context[k] = v;
      else if (typeof v === "string") context[k] = scrubText(v, 200);
      // arrays and objects (e.g. landmarks, frames) are never forwarded
    }
    if (Object.keys(context).length > 0) event.context = context;
  }
  return event;
}

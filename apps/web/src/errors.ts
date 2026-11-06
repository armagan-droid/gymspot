import { type ErrorEvent as ScrubbedEvent, scrubErrorEvent } from "@gymspot/shared";

// Uncaught errors → scrubbed reports (specs/02 "Hata izleme", specs/07).
// At most `maxPerMinute` reports, identical messages once per minute.

export interface ReporterOptions {
  send(event: ScrubbedEvent): Promise<unknown>;
  tags: () => ScrubbedEvent["tags"];
  now?: () => number;
  maxPerMinute?: number;
}

export function installErrorReporting(target: Pick<Window, "addEventListener" | "removeEventListener">, o: ReporterOptions): () => void {
  const now = o.now ?? Date.now;
  const sent: { at: number; message: string }[] = [];
  const report = (message: unknown, stack: unknown) => {
    const event = scrubErrorEvent({ message: String(message ?? ""), ...(typeof stack === "string" && { stack }), tags: o.tags() });
    const t = now();
    while (sent.length > 0 && t - sent[0]!.at > 60_000) sent.shift();
    if (sent.length >= (o.maxPerMinute ?? 10) || sent.some((s) => s.message === event.message)) return;
    sent.push({ at: t, message: event.message });
    void o.send(event).catch(() => undefined); // reporting must never throw
  };
  const onError = (e: Event) => {
    const ev = e as globalThis.ErrorEvent;
    report(ev.error?.message ?? ev.message, ev.error?.stack);
  };
  const onRejection = (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason as { message?: string; stack?: string } | string | undefined;
    report(typeof reason === "string" ? reason : reason?.message, typeof reason === "object" ? reason?.stack : undefined);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

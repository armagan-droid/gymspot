import type { SetupAssessment } from "@gymspot/engine";

// A3 spoken guidance (specs/08 "A3 görsel yönlendirme", 05 cooldown): the
// current hint once it has been stable for a moment, again after the
// cooldown if it persists, and "ready" once per transition.

export const SETUP_VOICE = { stableMs: 600, repeatMs: 4000 } as const;

export function createSetupVoice(speak: (key: string) => void) {
  let candidate: string | null = null;
  let since = 0;
  let spoken: string | null = null;
  let spokenAt = -Infinity;
  return (a: Pick<SetupAssessment, "ready" | "hints">, now: number): void => {
    const key = a.ready ? "setup.ready" : (a.hints[0] ?? null);
    if (key !== candidate) {
      candidate = key;
      since = now;
    }
    if (key === null || now - since < SETUP_VOICE.stableMs) return;
    const repeat = key !== "setup.ready" && now - spokenAt >= SETUP_VOICE.repeatMs;
    if (key !== spoken || repeat) {
      speak(key);
      spoken = key;
      spokenAt = now;
    }
  };
}

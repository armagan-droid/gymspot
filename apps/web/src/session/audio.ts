import type { RulePack } from "@gymspot/shared";
import type { i18n } from "i18next";

// Spoken feedback — specs/05 "Ses kaynağı sırası":
// pre-generated file → Web Speech → screen only. Browser APIs are injected.

export type CueChannel = "file" | "speech" | "screen";

export const cueAudioPath = (lang: string, exerciseId: string, faultId: string) => `audio/${lang}/${exerciseId}.${faultId}.mp3`;

export interface CuePlayerDeps {
  /** Paths of pre-generated audio files that exist (relative to the app root). */
  files: ReadonlySet<string>;
  playFile(path: string): void;
  /** Undefined when the browser has no speech synthesis. */
  speak?: (text: string, lang: string) => void;
  packs: Readonly<Record<string, RulePack>>;
  i18n: i18n;
  muted?: () => boolean;
}

/** Returns a player for SPEAK keys (`cue.<exerciseId>.<faultId>` or program message keys). */
export function createCuePlayer(d: CuePlayerDeps) {
  return (key: string): CueChannel => {
    const lang = d.i18n.language === "en" ? "en" : "tr";
    let text: string | undefined;
    let file: string | undefined;
    if (key.startsWith("cue.")) {
      const [, exerciseId = "", faultId = ""] = key.split(".");
      const fault = d.packs[exerciseId]?.faults.find((f) => f.id === faultId);
      if (!fault) return "screen";
      text = fault.cue[lang];
      file = cueAudioPath(lang, exerciseId, faultId);
    } else {
      text = d.i18n.t(key);
    }
    if (d.muted?.()) return "screen";
    if (file && d.files.has(file)) {
      d.playFile(file);
      return "file";
    }
    if (d.speak) {
      d.speak(text, lang);
      return "speech";
    }
    return "screen";
  };
}

/** Browser bindings: bundled audio files, HTMLAudioElement and speechSynthesis. */
export function browserCueDeps(): Pick<CuePlayerDeps, "files" | "playFile" | "speak"> {
  const found = Object.keys(import.meta.glob("/public/audio/**/*.mp3")).map((p) => p.replace(/^\/public\//, ""));
  const synth = globalThis.speechSynthesis;
  return {
    files: new Set(found),
    playFile: (path) => void new Audio(`/${path}`).play().catch(() => undefined),
    speak: synth
      ? (text, lang) => {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang === "en" ? "en-US" : "tr-TR";
          synth.cancel(); // one cue at a time (specs/05)
          synth.speak(u);
        }
      : undefined,
  };
}

import { describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n";
import { rulePack } from "../rules";
import { createCuePlayer, cueAudioPath } from "./audio";

const deps = (o: { files?: string[]; speech?: boolean } = {}) => ({
  files: new Set(o.files ?? []),
  playFile: vi.fn(),
  speak: o.speech === false ? undefined : vi.fn(),
});

describe("AC-5.5: cue audio source order (specs/05)", () => {
  const packs = { squat: rulePack("squat") };
  const i18n = createI18n("tr");

  test("pre-generated file is preferred", () => {
    const d = deps({ files: [cueAudioPath("tr", "squat", "knee_valgus")] });
    const play = createCuePlayer({ ...d, packs, i18n });
    expect(play("cue.squat.knee_valgus")).toBe("file");
    expect(d.playFile).toHaveBeenCalledWith("audio/tr/squat.knee_valgus.mp3");
    expect(d.speak).not.toHaveBeenCalled();
  });

  test("without a file the cue text from the rule pack is spoken", () => {
    const d = deps();
    const play = createCuePlayer({ ...d, packs, i18n });
    expect(play("cue.squat.knee_valgus")).toBe("speech");
    expect(d.speak).toHaveBeenCalledWith("Dizlerini dışarı aç", "tr");
  });

  test("uses the current language", () => {
    const en = createI18n("en");
    const d = deps();
    createCuePlayer({ ...d, packs, i18n: en })("cue.squat.knee_valgus");
    expect(d.speak).toHaveBeenCalledWith("Push your knees out", "en");
  });

  test("without speech synthesis only the screen shows it", () => {
    const d = deps({ speech: false });
    expect(createCuePlayer({ ...d, packs, i18n })("cue.squat.knee_valgus")).toBe("screen");
    expect(d.playFile).not.toHaveBeenCalled();
  });

  test("muted: nothing is played (screen cue stays)", () => {
    const d = deps({ files: [cueAudioPath("tr", "squat", "knee_valgus")] });
    const play = createCuePlayer({ ...d, packs, i18n, muted: () => true });
    expect(play("cue.squat.knee_valgus")).toBe("screen");
    expect(d.playFile).not.toHaveBeenCalled();
    expect(d.speak).not.toHaveBeenCalled();
  });

  test("program messages are spoken from i18n", () => {
    const d = deps();
    createCuePlayer({ ...d, packs, i18n })("safety.stop");
    expect(d.speak).toHaveBeenCalledWith("Dur, formunu kontrol et", "tr");
  });

  test("an unknown cue is not spoken", () => {
    const d = deps();
    expect(createCuePlayer({ ...d, packs, i18n })("cue.squat.nope")).toBe("screen");
    expect(d.speak).not.toHaveBeenCalled();
  });
});

import { describe, expect, test, vi } from "vitest";
import { SETUP_VOICE, createSetupVoice } from "./voice";

const hint = (h: string) => ({ ready: false, hints: [h] as never[] });
const ready = { ready: true, hints: [] };

describe("A3 spoken guidance", () => {
  test("a hint is spoken once it is stable, then not again before the cooldown", () => {
    const speak = vi.fn();
    const voice = createSetupVoice(speak);
    for (let t = 0; t <= SETUP_VOICE.repeatMs; t += 100) voice(hint("setup.hint.step_back"), t);
    expect(speak.mock.calls).toEqual([["setup.hint.step_back"]]);
    voice(hint("setup.hint.step_back"), SETUP_VOICE.stableMs + SETUP_VOICE.repeatMs);
    expect(speak).toHaveBeenCalledTimes(2); // still there after the cooldown: said again
  });

  test("a flickering hint is not spoken", () => {
    const speak = vi.fn();
    const voice = createSetupVoice(speak);
    for (let t = 0; t < 2000; t += 100) voice(hint(t % 200 === 0 ? "setup.hint.step_back" : "setup.hint.move_closer"), t);
    expect(speak).not.toHaveBeenCalled();
  });

  test("'ready' is said once per transition", () => {
    const speak = vi.fn();
    const voice = createSetupVoice(speak);
    for (let t = 0; t < 10_000; t += 100) voice(ready, t);
    expect(speak.mock.calls).toEqual([["setup.ready"]]);
    for (let t = 10_000; t < 11_000; t += 100) voice(hint("setup.hint.step_back"), t);
    for (let t = 11_000; t < 12_000; t += 100) voice(ready, t);
    expect(speak.mock.calls.map((c) => c[0])).toEqual(["setup.ready", "setup.hint.step_back", "setup.ready"]);
  });
});

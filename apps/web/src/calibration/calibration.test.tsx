import { squatFrame } from "@gymspot/engine/testing";
import { type Frame, LandmarkSequenceSchema } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n";
import type { PoseSource } from "../pose/source";
import { CALIBRATION_CONSENT_VERSION, CalibrationPage, type CalibrationSave } from "./CalibrationPage";

afterEach(cleanup);

function fakeSource() {
  let emit: ((c: Frame[], t: number) => void) | undefined;
  const source: PoseSource = { start: vi.fn(async (_v, cb) => void (emit = cb)), stop: vi.fn() };
  return {
    source,
    /** Two squats: one full, one shallow (front view, 30 fps). */
    async squats() {
      await act(async () => {
        const rep = (t0: number, depth: number) => (t: number) => {
          const p = Math.min(1, Math.max(0, (t - t0) / 2000));
          return 172 - (172 - depth) * ((1 - Math.cos(2 * Math.PI * p)) / 2);
        };
        const a = rep(1000, 90);
        const b = rep(3800, 120);
        for (let t = 0; t <= 6800; t += 1000 / 30) {
          const knee = t < 3400 ? a(t) : b(t);
          emit!([squatFrame({ kneeAngle: knee, torsoLean: 10 }, { view: "front", t })], t);
        }
      });
    },
  };
}

function renderPage(role: "owner" | "manager" | "trainer" = "manager") {
  const src = fakeSource();
  const onSave = vi.fn<(s: CalibrationSave) => void>();
  render(
    <I18nextProvider i18n={createI18n("tr")}>
      <CalibrationPage role={role} source={src.source} requestCamera={async () => ({ ok: true, stream: {} as MediaStream })} onSave={onSave} now={() => Date.UTC(2026, 10, 6, 10)} />
    </I18nextProvider>,
  );
  return { ...src, onSave };
}

async function consentAndStart() {
  fireEvent.change(screen.getByLabelText("Hareket"), { target: { value: "squat" } });
  fireEvent.change(screen.getByLabelText("Katılımcı kodu"), { target: { value: "P-007" } });
  fireEvent.click(screen.getByLabelText(/kalibrasyon kaydına açık rıza/i));
  fireEvent.click(screen.getByRole("button", { name: "Kaydı başlat" }));
  await screen.findByText("KALİBRASYON KAYDI");
}

describe("AC-7.5: calibration recording (specs/07)", () => {
  test("trainers cannot start it", () => {
    renderPage("trainer");
    expect(screen.getByRole("alert").textContent).toContain("yalnızca yönetici");
    expect(screen.queryByRole("button", { name: "Kaydı başlat" })).toBeNull();
  });

  test("needs a participant code and separate consent before starting", () => {
    renderPage();
    const start = screen.getByRole("button", { name: "Kaydı başlat" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Katılımcı kodu"), { target: { value: "P-007" } });
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/kalibrasyon kaydına açık rıza/i));
    expect(start.disabled).toBe(false);
  });

  test("shows a clear recording indicator while recording", async () => {
    renderPage();
    await consentAndStart();
    expect(screen.getByText("KALİBRASYON KAYDI").getAttribute("role")).toBe("status");
  });

  test("records landmarks only, labels attempts and saves a valid sequence with consent", async () => {
    const page = renderPage();
    await consentAndStart();
    await page.squats();
    fireEvent.click(screen.getByRole("button", { name: "Kaydı durdur" }));

    // engine suggestions: rep 1 valid, rep 2 faulty with insufficient_depth
    const rows = screen.getAllByRole("group");
    expect(rows).toHaveLength(2);
    expect((within(rows[0]!).getByLabelText("Sonuç") as HTMLSelectElement).value).toBe("valid");
    expect((within(rows[1]!).getByLabelText("Sonuç") as HTMLSelectElement).value).toBe("faulty");
    expect((within(rows[1]!).getByLabelText("Yetersiz derinlik") as HTMLInputElement).checked).toBe(true);

    // the operator corrects rep 1: it actually had knee valgus
    fireEvent.click(within(rows[0]!).getByLabelText("Diz içe kaçma"));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(page.onSave).toHaveBeenCalledTimes(1);
    const saved = page.onSave.mock.calls[0]![0];
    expect(saved.consent).toEqual({ participantRef: "P-007", consentVersion: CALIBRATION_CONSENT_VERSION, consentedAt: "2026-11-06T10:00:00.000Z" });
    const parsed = LandmarkSequenceSchema.safeParse(saved.sequence);
    expect(parsed.success).toBe(true); // strict schema: no image/video fields can exist
    expect(saved.sequence).toMatchObject({ source: "calibration", exerciseId: "squat", view: "front" });
    expect(saved.sequence.labels!.reps).toEqual([
      { outcome: "valid", faults: ["knee_valgus"] },
      { outcome: "faulty", faults: ["insufficient_depth"] },
    ]);
    expect(saved.sequence.frames.length).toBeGreaterThan(150);
    expect(Object.keys(saved.sequence.frames[0]!).sort()).toEqual(["image", "t", "world"]);
  });

  test("the camera stops when recording stops", async () => {
    const page = renderPage();
    await consentAndStart();
    fireEvent.click(screen.getByRole("button", { name: "Kaydı durdur" }));
    expect(page.source.stop).toHaveBeenCalled();
  });
});

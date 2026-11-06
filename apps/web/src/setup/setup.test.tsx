import type { Frame } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { pushupFrame, squatFrame } from "@gymspot/engine/testing";
import { I18nextProvider } from "react-i18next";
import { cameraErrorReason } from "../camera";
import { createI18n } from "../i18n";
import type { PoseSource } from "../pose/source";
import { rulePack } from "../rules";
import { SetupWizard } from "./SetupWizard";

afterEach(cleanup);

/** A pose source the test drives by hand. */
function fakeSource() {
  let emit: ((candidates: Frame[], t: number) => void) | undefined;
  const source: PoseSource = {
    start: vi.fn(async (_video, onResult) => {
      emit = onResult;
    }),
    stop: vi.fn(),
  };
  return {
    source,
    /** Emits one second of frames from `make` at 30 fps. */
    async feed(make: (t: number) => Frame | Frame[]) {
      await act(async () => {
        for (let i = 0; i < 31; i++) {
          const t = (i * 1000) / 30;
          const f = make(t);
          emit!(Array.isArray(f) ? f : [f], t);
        }
      });
    },
  };
}

const okCamera = () => vi.fn(async () => ({ ok: true as const, stream: {} as MediaStream }));

function renderWizard(props: Partial<Parameters<typeof SetupWizard>[0]> & { exercise?: string } = {}) {
  const { exercise = "squat", ...rest } = props;
  const src = fakeSource();
  const onReady = vi.fn();
  const onManualEntry = vi.fn();
  const requestCamera = rest.requestCamera ?? okCamera();
  render(
    <I18nextProvider i18n={createI18n("tr")}>
      <SetupWizard
        pack={rulePack(exercise)}
        consent
        source={src.source}
        requestCamera={requestCamera}
        onReady={onReady}
        onManualEntry={onManualEntry}
        {...rest}
      />
    </I18nextProvider>,
  );
  return { ...src, onReady, onManualEntry, requestCamera };
}

describe("camera permission (specs/08 'Kamera izni')", () => {
  test("AC-7.4: without consent the camera is never requested", async () => {
    const requestCamera = okCamera();
    renderWizard({ consent: false, requestCamera });
    expect(await screen.findByText("Kamerayı kullanmak için önce açık rıza vermelisin.")).toBeTruthy();
    expect(requestCamera).not.toHaveBeenCalled();
  });

  test("AC-8.3: a denied permission explains it and offers manual entry", async () => {
    const { onManualEntry } = renderWizard({ requestCamera: vi.fn(async () => ({ ok: false as const, reason: "denied" as const })) });
    expect(await screen.findByText(/Kamera izni verilmedi/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elle kaydet" }));
    expect(onManualEntry).toHaveBeenCalled();
  });

  test("an unavailable camera shows its own message", async () => {
    renderWizard({ requestCamera: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const })) });
    expect(await screen.findByText(/Kamera kullanılamıyor/)).toBeTruthy();
  });

  test("browser errors map to reasons", () => {
    expect(cameraErrorReason(new DOMException("x", "NotAllowedError"))).toBe("denied");
    expect(cameraErrorReason(new DOMException("x", "SecurityError"))).toBe("denied");
    expect(cameraErrorReason(new DOMException("x", "NotFoundError"))).toBe("unavailable");
    expect(cameraErrorReason(new Error("boom"))).toBe("unavailable");
  });
});

describe("A3 setup wizard", () => {
  test("AC-8.5: push-up seen from the front is not ready and asks to turn sideways", async () => {
    const w = renderWizard({ exercise: "pushup" });
    await screen.findByText(/Kamera kurulumu/);
    await w.feed((t) => pushupFrame({ elbowAngle: 165 }, { view: "front", t }));
    expect(screen.getByText("Yan dön, kamera seni yandan görsün")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Başla" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("push-up from the side becomes ready; start reports the setup", async () => {
    const w = renderWizard({ exercise: "pushup" });
    await screen.findByText(/Kamera kurulumu/);
    await w.feed((t) => pushupFrame({ elbowAngle: 165 }, { view: "side", facing: "left", t }));
    expect(screen.getByText("Hazır")).toBeTruthy();
    expect(screen.getByText("Yarım iniş")).toBeTruthy(); // active check names
    const start = screen.getByRole("button", { name: "Başla" }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(w.onReady).toHaveBeenCalledWith({ view: "side", nearSide: "right" });
  });

  test("shows the detected view and the checks active in it", async () => {
    const w = renderWizard();
    await screen.findByText(/Kamera kurulumu/);
    await w.feed((t) => squatFrame({ kneeAngle: 172 }, { view: "front", t }));
    expect(screen.getByText("Önden")).toBeTruthy();
    expect(screen.getByText("Diz içe kaçma")).toBeTruthy();
    expect(screen.queryByText("Gövdenin aşırı öne eğilmesi")).toBeNull(); // side-only
  });

  test("two similar people make the setup ambiguous", async () => {
    const w = renderWizard();
    await screen.findByText(/Kamera kurulumu/);
    const shift = (f: Frame, dx: number): Frame => ({ ...f, image: f.image.map((p) => ({ ...p, x: p.x + dx })) });
    await w.feed((t) => {
      const f = squatFrame({ kneeAngle: 172 }, { view: "front", t });
      return [shift(f, -0.05), shift(f, 0.05)];
    });
    expect(screen.getByText("Kamerada tek kişi olmalı")).toBeTruthy();
  });

  test("the pose source is stopped on unmount", async () => {
    const w = renderWizard();
    await screen.findByText(/Kamera kurulumu/);
    cleanup();
    expect(w.source.stop).toHaveBeenCalled();
  });
});

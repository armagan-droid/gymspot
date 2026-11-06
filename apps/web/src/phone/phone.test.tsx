import { createProgram, serializeProgram, step } from "@gymspot/engine";
import { type Workout, generateKeyPair, signDelegation, verifyQr } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import { createI18n } from "../i18n";
import { ServicesProvider } from "../services";
import { testServices } from "../test-services";
import { HandoffPanel, QR_REFRESH_MS } from "./HandoffPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";
const workout: Workout = {
  id: "mp-1:0",
  name: "Başlangıç · 1",
  blocks: [
    { exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 1, restSec: 30, mode: "strict" },
    { exerciseId: "pushup", exerciseVersion: 1, sets: 2, reps: 8, restSec: 60, mode: "strict", stationHint: "Şınav Alanı" },
  ],
};

/** Program state in TRANSFER to block 1 (squat done on the phone). */
function transferState() {
  let s = createProgram({ role: "owner", workout, sessionId: SESSION, memberId: MEMBER, memberProgramId: "mp-1", workoutDayIndex: 0, deviceId: "phone" }, NOW);
  let n = 0;
  const go = (i: Parameters<typeof step>[1]) => (s = step(s, i, { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` }).state);
  go({ type: "USER_ACTION", kind: "START" });
  go({ type: "USER_ACTION", kind: "START" });
  go({ type: "TICK", now: NOW + 3000 });
  go({ type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1500 });
  expect(s.status).toBe("TRANSFER");
  return s;
}

async function keys() {
  const tenant = await generateKeyPair();
  const phone = await generateKeyPair();
  const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phone.publicKeyB64, consent: true, exp: NOW + 24 * 3600_000 }, tenant.secretKey);
  return { tenant, phone, delegation };
}

describe("A7 handoff QR on the phone", () => {
  test("the QR verifies with the tenant key and carries the next block; it renews every 90 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const k = await keys();
    const t = testServices();
    const rendered: string[] = [];
    const onReturned = vi.fn();
    const onRunHere = vi.fn();
    render(
      <I18nextProvider i18n={createI18n("tr")}>
        <ServicesProvider services={t.services}>
          <HandoffPanel
            state={transferState()}
            phoneSecretKey={k.phone.secretKey}
            delegation={k.delegation}
            onReturned={onReturned}
            onRunHere={onRunHere}
            renderQr={async (text) => (rendered.push(text), `data:image/png;base64,${rendered.length}`)}
          />
        </ServicesProvider>
      </I18nextProvider>,
    );
    await vi.waitFor(() => expect(rendered).toHaveLength(1));
    expect(screen.getByRole("img", { name: "Devir QR kodu" })).toBeTruthy();
    expect(screen.getByText("Şınav Alanı")).toBeTruthy();
    const v = await verifyQr(rendered[0]!, k.tenant.publicKey, NOW);
    expect(v).toMatchObject({ ok: true, payload: { sid: SESSION, bi: 1, si: 0, blk: workout.blocks[1], mid: MEMBER } });

    await act(async () => void (await vi.advanceTimersByTimeAsync(QR_REFRESH_MS)));
    await vi.waitFor(() => expect(rendered).toHaveLength(2));
    expect(rendered[1]).not.toBe(rendered[0]); // new jti

    fireEvent.click(screen.getByRole("button", { name: "İstasyondan döndüm" }));
    fireEvent.click(screen.getByRole("button", { name: "Bu bloğu telefonda yap" }));
    expect(onReturned).toHaveBeenCalled();
    expect(onRunHere).toHaveBeenCalled();
  });
});

function renderPhone(t: ReturnType<typeof testServices>) {
  render(
    <MemoryRouter initialEntries={["/member/session"]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
}

const memberApi = (consent: boolean, delegation: Awaited<ReturnType<typeof keys>>["delegation"]) => ({
  memberProgram: vi.fn(async () => ({ memberProgramId: "mp-1", days: [workout], nextDayIndex: 0 })),
  me: vi.fn(async () => ({ id: MEMBER, displayName: "Ayşe", email: null, cameraConsent: consent, consentVersion: consent ? "v1" : null })),
  qrDelegation: vi.fn(async () => delegation),
});

describe("phone-owned session (specs/03)", () => {
  test("signed out → sign-in link", async () => {
    renderPhone(testServices());
    expect(await screen.findByText("Seansı başlatmak için giriş yapmalısın.")).toBeTruthy();
  });

  test("today's workout overview, then camera setup for the first block", async () => {
    const k = await keys();
    const t = testServices({ credentials: { member: { accessToken: "a", refreshToken: "r" } }, api: memberApi(true, k.delegation) });
    renderPhone(t);
    expect(await screen.findByRole("heading", { name: "Antrenman özeti" })).toBeTruthy();
    expect(screen.getByText(/Şınav · 2 × 8 · Şınav Alanı/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Başla" }));
    expect(await screen.findByRole("heading", { name: "Kamera kurulumu" })).toBeTruthy();
  });

  test("AC-7.4: without consent the setup does not open the camera", async () => {
    const k = await keys();
    const t = testServices({ credentials: { member: { accessToken: "a", refreshToken: "r" } }, api: memberApi(false, k.delegation) });
    renderPhone(t);
    fireEvent.click(await screen.findByRole("button", { name: "Başla" }));
    expect(await screen.findByText(/önce açık rıza vermelisin/)).toBeTruthy();
    expect(t.services.requestCamera).not.toHaveBeenCalled();
  });

  test("AC-3.5: a reloaded page resumes the session (here: waiting for the station)", async () => {
    const k = await keys();
    const t = testServices({ credentials: { member: { accessToken: "a", refreshToken: "r" } }, api: memberApi(true, k.delegation) });
    t.storage.setItem("gymspot.member.session", serializeProgram(transferState()));
    renderPhone(t);
    expect(await screen.findByRole("heading", { name: "Sıradaki istasyona geç" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "İstasyondan döndüm" }));
    expect(await screen.findByText("Seans tamamlandı")).toBeTruthy();
  });

  test("offline: the last known program is used", async () => {
    const k = await keys();
    const t = testServices({
      credentials: { member: { accessToken: "a", refreshToken: "r" } },
      api: { memberProgram: vi.fn(async () => Promise.reject(new Error("offline"))), me: vi.fn(), qrDelegation: vi.fn(async () => k.delegation) },
    });
    t.storage.setItem("gymspot.member.program", JSON.stringify({ memberProgramId: "mp-1", days: [workout], nextDayIndex: 0 }));
    renderPhone(t);
    expect(await screen.findByRole("heading", { name: "Antrenman özeti" })).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type GymApi, type MemberProfile, NetworkError } from "../api/client";
import { App } from "../App";
import { createI18n } from "../i18n";
import { testServices } from "../test-services";
import { CONSENT_VERSION } from "./consent";

afterEach(cleanup);

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const signedIn = { member: { accessToken: "a", refreshToken: "r" } };
const profile = (o: Partial<MemberProfile> = {}): MemberProfile => ({ id: "m1", displayName: "Ayşe", email: "ayse@a.test", cameraConsent: true, consentVersion: CONSENT_VERSION, ...o });
const program = {
  memberProgramId: "mp-1",
  nextDayIndex: 1,
  days: [
    { id: "mp-1:0", name: "Başlangıç · 1", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 3, reps: 10, restSec: 90, mode: "strict" as const }] },
    { id: "mp-1:1", name: "Başlangıç · 2", blocks: [{ exerciseId: "pushup", exerciseVersion: 1, sets: 3, reps: 8, restSec: 60, mode: "strict" as const }] },
  ],
};

function renderAt(path: string, t: ReturnType<typeof testServices>) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
}

describe("B1 sign-in and consent", () => {
  test("an invite link signs in, remembers the gym, and asks for consent", async () => {
    const api: Partial<GymApi> = {
      verifyMagicLink: vi.fn(async () => undefined),
      me: vi.fn(async () => profile({ cameraConsent: false, consentVersion: null })),
      giveConsent: vi.fn(async () => undefined),
      memberProgram: vi.fn(async () => program),
      mySessions: vi.fn(async () => []),
    };
    const t = testServices({ api });
    (api.verifyMagicLink as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      t.services.store.set("member", signedIn.member);
      t.services.store.set("tenant", TENANT);
    });
    renderAt(`/member/login?token=${TENANT}.secret`, t);
    expect(await screen.findByRole("heading", { name: "Aydınlatma ve açık rıza" })).toBeTruthy();
    expect(api.verifyMagicLink).toHaveBeenCalledWith(`${TENANT}.secret`);
    expect(screen.getByText(/görüntü saklanmaz/i)).toBeTruthy();
    const accept = screen.getByRole("button", { name: "Onaylıyorum" }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/okudum/));
    fireEvent.click(accept);
    expect(await screen.findByRole("heading", { name: "Bugünün antrenmanı" })).toBeTruthy();
    expect(api.giveConsent).toHaveBeenCalledWith(CONSENT_VERSION);
  });

  test("'not now' skips consent (the camera will stay off)", async () => {
    const t = testServices({
      credentials: signedIn,
      api: { me: vi.fn(async () => profile({ cameraConsent: false, consentVersion: null })), giveConsent: vi.fn(), memberProgram: vi.fn(async () => program), mySessions: vi.fn(async () => []) },
    });
    renderAt("/member/login", t);
    fireEvent.click(await screen.findByRole("button", { name: "Şimdi değil" }));
    expect(await screen.findByRole("heading", { name: "Bugünün antrenmanı" })).toBeTruthy();
    expect(t.services.api.giveConsent).not.toHaveBeenCalled();
  });

  test("a changed consent text asks again", async () => {
    const t = testServices({ credentials: signedIn, api: { me: vi.fn(async () => profile({ consentVersion: "2025-01-v0" })), memberProgram: vi.fn(async () => program), mySessions: vi.fn(async () => []) } });
    renderAt("/member/login", t);
    expect(await screen.findByRole("heading", { name: "Aydınlatma ve açık rıza" })).toBeTruthy();
  });

  test("a known gym: e-mail form sends a link", async () => {
    const requestMagicLink = vi.fn(async () => undefined);
    const t = testServices({ credentials: { tenant: TENANT }, api: { requestMagicLink } });
    renderAt("/member/login", t);
    fireEvent.change(await screen.findByLabelText("E-posta"), { target: { value: "ayse@a.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Giriş bağlantısı gönder" }));
    expect(await screen.findByText(/E-postanı kontrol et/)).toBeTruthy();
    expect(requestMagicLink).toHaveBeenCalledWith(TENANT, "ayse@a.test");
  });

  test("an unknown gym: use the invite link", async () => {
    renderAt("/member/login", testServices());
    expect(await screen.findByText(/davet bağlantısını kullan/)).toBeTruthy();
  });

  test("an unreachable server is not an invalid link: it says so and retries", async () => {
    const verify = vi.fn().mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce(undefined);
    const t = testServices({ api: { verifyMagicLink: verify } });
    renderAt(`/member/login?token=${TENANT}.fresh`, t);
    expect(await screen.findByText(/Sunucuya ulaşılamadı/)).toBeTruthy();
    expect(screen.queryByText(/bağlantı geçersiz/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    expect(verify).toHaveBeenLastCalledWith(`${TENANT}.fresh`);
  });

  test("an expired link says so", async () => {
    const t = testServices({ api: { verifyMagicLink: vi.fn(async () => Promise.reject(new Error("401"))) } });
    renderAt(`/member/login?token=${TENANT}.old`, t);
    expect(await screen.findByText(/bağlantı geçersiz ya da süresi dolmuş/)).toBeTruthy();
  });
});

describe("B2–B5", () => {
  const api = () => ({
    memberProgram: vi.fn(async () => program),
    mySessions: vi.fn(async () => [
      { id: "s1", workoutDayIndex: 0, startedAt: "2026-11-05T08:00:00.000Z", endedAt: "2026-11-05T08:40:00.000Z", status: "done" },
      { id: "s0", workoutDayIndex: 1, startedAt: "2026-10-20T08:00:00.000Z", endedAt: null, status: "aborted" },
    ]),
    mySession: vi.fn(async () => ({
      id: "s1",
      workoutDayIndex: 0,
      startedAt: "2026-11-05T08:00:00.000Z",
      endedAt: "2026-11-05T08:40:00.000Z",
      status: "done",
      blocks: [{ position: 0, exerciseId: "squat", status: "done", plannedSets: 1, sets: [{ setIndex: 0, plannedReps: 10, validReps: 8, faultyReps: 2, incompleteReps: 1, faults: [{ faultId: "knee_valgus", count: 2 }] }] }],
    })),
    myProgress: vi.fn(async () => [{ week: "2026-11-02", exerciseId: "squat", valid: 8, faulty: 2, incomplete: 1, cleanRatio: 0.8 }]),
  });

  test("not signed in → sign-in page", async () => {
    renderAt("/member", testServices());
    expect(await screen.findByText(/davet bağlantısını kullan/)).toBeTruthy();
  });

  test("B2: today's workout (next day), this week's sessions, start link", async () => {
    renderAt("/member", testServices({ credentials: signedIn, api: api() }));
    expect(await screen.findByText("Başlangıç · 2")).toBeTruthy();
    expect(screen.getByText(/Şınav · 3 × 8/)).toBeTruthy();
    expect(screen.getByText("Bu hafta tamamlanan seans: 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Seansı başlat" }).getAttribute("href")).toBe("/member/session");
  });

  test("B3: all program days", async () => {
    renderAt("/member/program", testServices({ credentials: signedIn, api: api() }));
    expect(await screen.findByText("Başlangıç · 1")).toBeTruthy();
    expect(screen.getByText("Başlangıç · 2")).toBeTruthy();
  });

  test("B4: history list and session detail with fault names", async () => {
    renderAt("/member/history", testServices({ credentials: signedIn, api: api() }));
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    fireEvent.click(within(items[0]!).getByRole("link"));
    expect(await screen.findByText(/8 temiz · 2 hatalı · 1 yarım/)).toBeTruthy();
    expect(screen.getByText(/Diz içe kaçma × 2/)).toBeTruthy();
  });

  test("B5: weekly progress table", async () => {
    renderAt("/member/progress", testServices({ credentials: signedIn, api: api() }));
    const row = (await screen.findByText("2026-11-02")).closest("tr")!;
    expect(within(row).getByText("Squat")).toBeTruthy();
    expect(within(row).getByText("%80")).toBeTruthy();
  });
});

describe("B6 settings and data rights (specs/07)", () => {
  const api = (consent = true) => ({
    me: vi.fn(async () => profile({ cameraConsent: consent })),
    withdrawConsent: vi.fn(async () => undefined),
    giveConsent: vi.fn(async () => undefined),
    exportMyData: vi.fn(async () => ({ profile: { id: "m1" } })),
    requestDeletion: vi.fn(async () => undefined),
    signOutMember: vi.fn(async () => undefined),
  });

  test("shows the disclaimer and language/theme switches", async () => {
    renderAt("/member/settings", testServices({ credentials: signedIn, api: api() }));
    expect(await screen.findByText("Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur.")).toBeTruthy();
    expect(screen.getByLabelText("Dil")).toBeTruthy();
  });

  test("withdraw camera consent", async () => {
    const t = testServices({ credentials: signedIn, api: api(true) });
    renderAt("/member/settings", t);
    fireEvent.click(await screen.findByRole("button", { name: "Kamera rızamı geri çek" }));
    expect(t.services.api.withdrawConsent).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Kamera rızası ver" })).toBeTruthy();
  });

  test("download my data", async () => {
    const t = testServices({ credentials: signedIn, api: api() });
    const download = vi.fn();
    t.services.download = download;
    renderAt("/member/settings", t);
    fireEvent.click(await screen.findByRole("button", { name: "Verilerimi indir" }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith("gymspot-verilerim.json", expect.stringContaining('"m1"')));
  });

  test("request deletion after confirming", async () => {
    const t = testServices({ credentials: signedIn, api: api() });
    renderAt("/member/settings", t);
    fireEvent.click(await screen.findByRole("button", { name: "Verilerimin silinmesini iste" }));
    fireEvent.click(screen.getByRole("button", { name: "Evet, silinsin" }));
    expect(await screen.findByText(/30 gün içinde/)).toBeTruthy();
    expect(t.services.api.requestDeletion).toHaveBeenCalled();
  });

  test("sign out", async () => {
    const t = testServices({ credentials: signedIn, api: api() });
    renderAt("/member/settings", t);
    fireEvent.click(await screen.findByRole("button", { name: "Çıkış yap" }));
    await vi.waitFor(() => expect(t.services.api.signOutMember).toHaveBeenCalled());
  });
});

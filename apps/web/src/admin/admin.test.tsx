import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import type { StaffApi, StaffRole } from "../api/staff";
import { App } from "../App";
import { createI18n } from "../i18n";
import { testServices } from "../test-services";

afterEach(cleanup);

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const signedIn = { staff: { accessToken: "a", refreshToken: "r" }, staffTenant: TENANT };

function renderAt(path: string, staff: Partial<StaffApi>, credentials: Record<string, unknown> = signedIn) {
  const t = testServices({ staff, credentials });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
  return t;
}
const as = (role: StaffRole, more: Partial<StaffApi> = {}): Partial<StaffApi> => ({ role: () => role, ...more });

describe("C1 staff sign-in", () => {
  test("asks for the gym id when unknown, then signs in and remembers it", async () => {
    const login = vi.fn(async () => undefined);
    const t = renderAt("/admin/login", { role: () => null, login, overview: vi.fn(async () => ({ activeSessions: 0, sessionsToday: 0, stations: [] })) }, {});
    fireEvent.change(await screen.findByLabelText("Salon kimliği"), { target: { value: TENANT } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "sahip@a.test" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "doğru-parola-123" } });
    login.mockImplementation(async () => {
      t.services.store.set("staff", signedIn.staff);
      t.services.store.set("staffTenant", TENANT);
      t.services.staff.role = () => "owner";
    });
    fireEvent.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByRole("heading", { name: "Genel bakış" })).toBeTruthy();
    expect(login).toHaveBeenCalledWith(TENANT, "sahip@a.test", "doğru-parola-123");
  });

  test("the gym id from the setup link is used without asking", async () => {
    renderAt(`/admin/login?tenant=${TENANT}`, { role: () => null, login: vi.fn() }, {});
    await screen.findByLabelText("E-posta");
    expect(screen.queryByLabelText("Salon kimliği")).toBeNull();
  });

  test("wrong credentials and lockout have messages", async () => {
    const login = vi.fn(async () => Promise.reject(new ApiError(401, null)));
    renderAt("/admin/login", { role: () => null, login }, { staffTenant: TENANT });
    fireEvent.change(await screen.findByLabelText("E-posta"), { target: { value: "x@a.test" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "yanlış" } });
    fireEvent.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByText("E-posta veya şifre hatalı.")).toBeTruthy();
    login.mockImplementation(async () => Promise.reject(new ApiError(429, null)));
    fireEvent.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByText(/15 dakika/)).toBeTruthy();
  });

  test("signed-out visitors are sent to sign-in", async () => {
    renderAt("/admin/members", { role: () => null }, {});
    expect(await screen.findByRole("button", { name: "Giriş yap" })).toBeTruthy();
  });
});

describe("role-based navigation (specs/06)", () => {
  test("trainers see members and templates, not overview/stations/settings", async () => {
    renderAt("/admin/members", as("trainer", { members: vi.fn(async () => []) }));
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Üyeler" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Program şablonları" })).toBeTruthy();
    expect(within(nav).queryByRole("link", { name: "Genel bakış" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "İstasyonlar" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Salon ayarları" })).toBeNull();
  });

  test("a trainer opening the overview lands on members", async () => {
    renderAt("/admin", as("trainer", { members: vi.fn(async () => []) }));
    expect(await screen.findByRole("heading", { name: "Üyeler" })).toBeTruthy();
  });
});

describe("C2–C3", () => {
  test("overview counts and station health", async () => {
    renderAt("/admin", as("manager", { overview: vi.fn(async () => ({ activeSessions: 2, sessionsToday: 7, stations: [{ id: "s1", name: "Squat Rafı 2", devices: 1, lastSeenAt: null }] })) }));
    expect(await screen.findByText("Aktif seans: 2")).toBeTruthy();
    expect(screen.getByText("Bugün: 7")).toBeTruthy();
    expect(screen.getByText(/Squat Rafı 2/)).toBeTruthy();
  });

  test("stations: create and show a pairing code", async () => {
    const createStation = vi.fn(async () => ({ id: "s2" }));
    const stations = vi.fn(async () => [{ id: "s1", name: "Squat Rafı 2", exerciseIds: ["squat"], devices: [] }]);
    const pairingCode = vi.fn(async () => ({ code: "ABCD2345", expiresAt: "2026-11-06T10:10:00.000Z" }));
    renderAt("/admin/stations", as("manager", { stations, createStation, pairingCode }));
    fireEvent.click(await screen.findByRole("button", { name: "Eşleştirme kodu üret" }));
    expect(await screen.findByText("ABCD2345")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("İstasyon adı"), { target: { value: "Şınav Alanı" } });
    fireEvent.click(screen.getByRole("button", { name: "İstasyon ekle" }));
    await vi.waitFor(() => expect(createStation).toHaveBeenCalledWith("Şınav Alanı", []));
  });
});

describe("C4–C6", () => {
  const member = { id: "m1", displayName: "Ayşe Yılmaz", email: "ayse@a.test", phone: null, status: "active", cameraConsent: true };

  test("members: search and add with invite", async () => {
    const members = vi.fn(async () => [member]);
    const createMember = vi.fn(async () => member);
    renderAt("/admin/members", as("manager", { members, createMember }));
    expect(await screen.findByRole("link", { name: "Ayşe Yılmaz" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Ad soyad"), { target: { value: "Burak Demir" } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "burak@a.test" } });
    fireEvent.click(screen.getByLabelText("Davet bağlantısı gönder"));
    fireEvent.click(screen.getByRole("button", { name: "Üye ekle" }));
    await vi.waitFor(() => expect(createMember).toHaveBeenCalledWith({ displayName: "Burak Demir", email: "burak@a.test", invite: true }));
  });

  test("member detail: insights with fault names, program and trainer assignment", async () => {
    const assignProgram = vi.fn(async () => undefined);
    const assignTrainer = vi.fn(async () => undefined);
    renderAt(
      "/admin/members/m1",
      as("manager", {
        member: vi.fn(async () => member),
        memberSessions: vi.fn(async () => [{ id: "s1", workoutDayIndex: 0, startedAt: "2026-11-05T08:00:00.000Z", endedAt: null, status: "done" }]),
        memberInsights: vi.fn(async () => ({ topFaults: [{ exerciseId: "squat", faultId: "knee_valgus", count: 4 }], weeklySessions: [{ week: "2026-11-02", sessions: 2 }] })),
        templates: vi.fn(async () => [{ id: "t1", name: "Başlangıç", blockCount: 3 }]),
        trainers: vi.fn(async () => [{ id: "u2", email: "pt@a.test" }]),
        assignProgram,
        assignTrainer,
      }),
    );
    expect(await screen.findByRole("heading", { name: "Ayşe Yılmaz" })).toBeTruthy();
    expect(await screen.findByText("Diz içe kaçma (Squat): 4")).toBeTruthy();
    expect(screen.getByText("2026-11-02: 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Program şablonu"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Programı ata" }));
    await vi.waitFor(() => expect(assignProgram).toHaveBeenCalledWith("m1", "t1", "2026-11-06"));
    fireEvent.change(screen.getByLabelText("Antrenör"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Antrenör ata" }));
    await vi.waitFor(() => expect(assignTrainer).toHaveBeenCalledWith("m1", "u2"));
  });

  test("AC-7.7: a manager creates a sign-in link to copy or scan; trainers don't get the button", async () => {
    const link = "https://app.test/member/login?token=aaaa.bbbb";
    const memberLoginLink = vi.fn(async () => ({ link, expiresAt: "2026-11-06T10:15:00.000Z" }));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const detail = {
      member: vi.fn(async () => member),
      memberSessions: vi.fn(async () => []),
      memberInsights: vi.fn(async () => ({ topFaults: [], weeklySessions: [] })),
      templates: vi.fn(async () => []),
      trainers: vi.fn(async () => []),
      memberLoginLink,
    };
    renderAt("/admin/members/m1", as("manager", detail));
    fireEvent.click(await screen.findByRole("button", { name: "Giriş bağlantısı oluştur" }));
    expect(((await screen.findByLabelText("Giriş bağlantısı")) as HTMLInputElement).value).toBe(link);
    expect(memberLoginLink).toHaveBeenCalledWith("m1");
    expect(screen.getByRole("img", { name: "Giriş bağlantısı QR kodu" }).getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    fireEvent.click(screen.getByRole("button", { name: "Kopyala" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(await screen.findByRole("button", { name: "Kopyalandı" })).toBeTruthy();
    cleanup();

    renderAt("/admin/members/m1", as("trainer", detail));
    expect(await screen.findByRole("heading", { name: "Ayşe Yılmaz" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Giriş bağlantısı oluştur" })).toBeNull();
  });
});

describe("C5 templates", () => {
  test("build a template with blocks; the gym default mode is preselected", async () => {
    const saveTemplate = vi.fn(async () => ({ id: "t9" }));
    renderAt("/admin/templates/new", as("trainer", { saveTemplate, settings: vi.fn(async () => ({ defaultMode: "lenient" as const, retentionMonths: 24, safetyPause: true })), templates: vi.fn(async () => []) }));
    fireEvent.change(await screen.findByLabelText("Şablon adı"), { target: { value: "Başlangıç" } });
    fireEvent.click(screen.getByRole("button", { name: "Blok ekle" }));
    const row = screen.getAllByRole("group")[0]!;
    await vi.waitFor(() => expect((within(row).getByLabelText("Mod") as HTMLSelectElement).value).toBe("lenient"));
    fireEvent.change(within(row).getByLabelText("Hareket"), { target: { value: "pushup" } });
    fireEvent.change(within(row).getByLabelText("Tekrar"), { target: { value: "8" } });
    fireEvent.change(within(row).getByLabelText("İstasyon"), { target: { value: "Şınav Alanı" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(() =>
      expect(saveTemplate).toHaveBeenCalledWith(null, {
        name: "Başlangıç",
        blocks: [{ dayIndex: 0, position: 0, exerciseId: "pushup", sets: 3, reps: 8, restSec: 60, mode: "lenient", stationHint: "Şınav Alanı" }],
      }),
    );
  });

  test("deleting a template in use explains why it failed", async () => {
    renderAt(
      "/admin/templates",
      as("manager", { templates: vi.fn(async () => [{ id: "t1", name: "Başlangıç", blockCount: 3 }]), deleteTemplate: vi.fn(async () => Promise.reject(new ApiError(409, { error: "template_in_use" }))) }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sil" }));
    expect(await screen.findByText(/üyeye atanmış/)).toBeTruthy();
  });
});

describe("C8 settings (owner)", () => {
  const staff = (more: Partial<StaffApi> = {}) =>
    as("owner", {
      settings: vi.fn(async () => ({ defaultMode: "strict" as const, retentionMonths: 24, safetyPause: true })),
      saveSettings: vi.fn(async (s) => s),
      users: vi.fn(async () => [{ id: "u1", email: "sahip@a.test", role: "owner" as const, status: "active" }]),
      createUser: vi.fn(async () => undefined),
      completeDataRequest: vi.fn(async () => undefined),
      dataRequests: vi.fn(async () => [{ id: "r1", kind: "delete", memberName: "Ayşe", requestedAt: "2026-11-06T10:00:00.000Z", completedAt: null }]),
      ...more,
    });

  test("save settings, add staff, see data requests and the notice template", async () => {
    const s = staff();
    renderAt("/admin/settings", s);
    fireEvent.click(await screen.findByLabelText("Güvenlik duraklatması"));
    fireEvent.change(screen.getByLabelText("Saklama süresi (ay)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Ayarları kaydet" }));
    await vi.waitFor(() => expect(s.saveSettings).toHaveBeenCalledWith({ defaultMode: "strict", retentionMonths: 12, safetyPause: false }));

    fireEvent.change(screen.getByLabelText("Personel e-postası"), { target: { value: "pt9@a.test" } });
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "trainer" } });
    fireEvent.change(screen.getByLabelText("Geçici şifre"), { target: { value: "en-az-on-iki-karakter" } });
    fireEvent.click(screen.getByRole("button", { name: "Personel ekle" }));
    await vi.waitFor(() => expect(s.createUser).toHaveBeenCalledWith({ email: "pt9@a.test", role: "trainer", password: "en-az-on-iki-karakter" }));

    expect(await screen.findByText(/Ayşe · silme/)).toBeTruthy();
    vi.stubGlobal("confirm", () => true);
    fireEvent.click(screen.getByRole("button", { name: "Silme işlemini uygula" }));
    await vi.waitFor(() => expect(s.completeDataRequest).toHaveBeenCalledWith("r1"));
    vi.unstubAllGlobals();
    expect(screen.getByText(/Bu alanda kamera ile hareket analizi yapılmaktadır/)).toBeTruthy();
    expect(screen.getByText("Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur.")).toBeTruthy();
  });

  test("managers cannot open owner settings", async () => {
    renderAt("/admin/settings", as("manager", { overview: vi.fn(async () => ({ activeSessions: 0, sessionsToday: 0, stations: [] })) }));
    expect(await screen.findByRole("heading", { name: "Genel bakış" })).toBeTruthy();
  });
});

describe("C10 calibration upload", () => {
  test("records consent first, then uploads the sequence", async () => {
    const calibrationConsent = vi.fn(async () => ({ id: "c1" }));
    const uploadCalibration = vi.fn(async () => ({ id: "r1" }));
    renderAt("/admin/calibration", as("manager", { calibrationConsent, uploadCalibration }));
    expect(await screen.findByRole("button", { name: "Kaydı başlat" })).toBeTruthy();
    // the page's save path is exercised directly to keep the test fast
    const { uploadCalibrationSave } = await import("./pages");
    await uploadCalibrationSave(
      { calibrationConsent, uploadCalibration } as unknown as StaffApi,
      { consent: { participantRef: "P-1", consentVersion: "v1", consentedAt: "2026-11-06T10:00:00.000Z" }, sequence: { formatVersion: 1 } as never },
    );
    expect(calibrationConsent).toHaveBeenCalledWith({ participantRef: "P-1", consentVersion: "v1", consentedAt: "2026-11-06T10:00:00.000Z" });
    expect(uploadCalibration).toHaveBeenCalledWith("c1", { formatVersion: 1 });
  });

  test("trainers are refused", async () => {
    renderAt("/admin/calibration", as("trainer", { members: vi.fn(async () => []) }));
    expect(await screen.findByText(/yalnızca yönetici/)).toBeTruthy();
  });
});

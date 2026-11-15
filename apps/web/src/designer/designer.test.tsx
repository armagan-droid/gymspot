import { safeLoadRulePack } from "@gymspot/engine";
import { squatSequence } from "@gymspot/engine/testing";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import type { GymExerciseRow, StaffApi, StaffRole } from "../api/staff";
import { App } from "../App";
import { createI18n } from "../i18n";
import { rulePack } from "../rules";
import { testServices } from "../test-services";
import { startFrom } from "./model";

// C11 exercise designer screens (specs/11, 08).

afterEach(cleanup);

const signedIn = { staff: { accessToken: "a", refreshToken: "r" }, staffTenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
function renderAt(path: string, role: StaffRole, staff: Partial<StaffApi>) {
  const t = testServices({ staff: { role: () => role, exercises: vi.fn(async () => []), ...staff }, credentials: signedIn });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
  return t;
}

const rows: GymExerciseRow[] = [
  { id: "t_sumo", name: { tr: "Sumo squat", en: "Sumo squat" }, publishedVersion: 2, draft: true, draftUpdatedAt: "2026-11-15T10:00:00Z" },
  { id: "t_lunge", name: { tr: "Hamle", en: "Lunge" }, publishedVersion: null, draft: true, draftUpdatedAt: "2026-11-15T10:00:00Z" },
];
const sumo = () => startFrom(rulePack("squat"), "t_sumo", { tr: "Sumo squat", en: "Sumo squat" }, true);

describe("C11 list", () => {
  test("managers see the gym's exercises with their state and can start a new one", async () => {
    renderAt("/admin/exercises", "manager", { gymExercises: vi.fn(async () => rows) });
    const item = (await screen.findByRole("link", { name: "Sumo squat" })).closest("li")!;
    expect(item.textContent).toContain("yayında · s2");
    expect(item.textContent).toContain("taslak");
    expect(screen.getByRole("link", { name: "Yeni hareket" })).toBeTruthy();
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Hareket tasarlayıcı" })).toBeTruthy();
  });

  test("trainers see the list only", async () => {
    renderAt("/admin/exercises", "trainer", { gymExercises: vi.fn(async () => rows), members: vi.fn(async () => []) });
    expect(await screen.findByText("Hamle")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Hamle" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Yeni hareket" })).toBeNull();
  });
});

describe("C11 new exercise", () => {
  test("the id follows the name; a starter makes a valid draft and opens the editor", async () => {
    const saveExerciseDraft = vi.fn(async () => ({ issues: [] }));
    const exerciseDraft = vi.fn(async () => ({ definition: sumo(), issues: [], updatedAt: "x" }));
    renderAt("/admin/exercises/new", "manager", { gymExercises: vi.fn(async () => []), saveExerciseDraft, exerciseDraft });
    fireEvent.change(await screen.findByLabelText("Ad (Türkçe)"), { target: { value: "Sumo Squat" } });
    expect((screen.getByLabelText("Kimlik") as HTMLInputElement).value).toBe("t_sumo_squat");
    fireEvent.click(screen.getByLabelText(/eklem açısı/));
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(saveExerciseDraft).toHaveBeenCalled());
    const [id, def] = saveExerciseDraft.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(id).toBe("t_sumo_squat");
    expect(def).toMatchObject({ id: "t_sumo_squat", version: 1, name: { tr: "Sumo Squat", en: "Sumo Squat" }, faults: [] });
    expect(safeLoadRulePack(def).success).toBe(true);
    expect(await screen.findByRole("heading", { name: "Sumo squat" })).toBeTruthy();
    expect(exerciseDraft).toHaveBeenCalledWith("t_sumo_squat");
  });

  test("copying keeps the source's faults; a taken id is refused", async () => {
    const saveExerciseDraft = vi.fn(async () => ({ issues: [] }));
    renderAt("/admin/exercises/new", "manager", { gymExercises: vi.fn(async () => rows), saveExerciseDraft, exerciseDraft: vi.fn(async () => ({ definition: sumo(), issues: [], updatedAt: "x" })) });
    fireEvent.change(await screen.findByLabelText("Ad (Türkçe)"), { target: { value: "Sumo" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(await screen.findByText("Bu kimlik zaten kullanılıyor.")).toBeTruthy();
    expect(saveExerciseDraft).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Kimlik"), { target: { value: "t_sumo_2" } });
    fireEvent.click(screen.getByLabelText("Var olan hareketi kopyala"));
    fireEvent.change(screen.getByRole("combobox", { name: "Var olan hareketi kopyala" }), { target: { value: "squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(saveExerciseDraft).toHaveBeenCalled());
    const def = (saveExerciseDraft.mock.calls[0] as unknown as [string, { faults: unknown[] }])[1];
    expect(def.faults).toEqual(rulePack("squat").faults);
  });
});

describe("C11 editor", () => {
  const open = (definition: Record<string, unknown>, more: Partial<StaffApi> = {}) => {
    const api = {
      exerciseDraft: vi.fn(async () => ({ definition, issues: [], updatedAt: "x" })),
      saveExerciseDraft: vi.fn(async () => ({ issues: [] })),
      publishExercise: vi.fn(async () => ({ version: 1 })),
      gymExercises: vi.fn(async () => rows),
    };
    const t = renderAt("/admin/exercises/t_sumo", "manager", { ...api, ...more });
    return { ...api, t };
  };
  /** Live trial with synthetic squats seen from the side. */
  const trial = async (t: ReturnType<typeof renderAt>, reps: { kneeAngle: number }[]) => {
    fireEvent.click(await screen.findByRole("button", { name: "Denemeyi başlat" }));
    await waitFor(() => expect(t.pose.emit).toBeDefined());
    const { frames } = squatSequence({ view: "side", reps });
    await act(async () => {
      for (const f of frames) t.pose.emit!([f], f.t);
    });
  };

  test("form edits change the pack; save, then publish", async () => {
    const api = open(sumo());
    expect(await screen.findByText(/Salon tanımlı hareket — doğrulanmamıştır. Tıbbi tavsiye değildir./)).toBeTruthy();
    expect(screen.getByText("Paket geçerli.")).toBeTruthy();
    const publish = screen.getByRole("button", { name: "Yayınla" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true); // not tried yet
    expect(screen.getByText(/en az bir tekrar yapın/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Hedef: giriş"), { target: { value: "95" } });
    expect(publish.disabled).toBe(true); // unsaved changes are not published
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(api.saveExerciseDraft).toHaveBeenCalled());
    const saved = (api.saveExerciseDraft.mock.calls[0] as unknown as [string, { rep: { target: { enter: number } } }])[1];
    expect(saved.rep.target.enter).toBe(95);
    await screen.findByText("Taslak kaydedildi.");
    expect(publish.disabled).toBe(true);
    await trial(api.t, [{ kneeAngle: 80 }]);
    expect(publish.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yayınla" }));
    await waitFor(() => expect(api.publishExercise).toHaveBeenCalledWith("t_sumo"));
    expect(await screen.findByRole("heading", { name: "Hareket tasarlayıcı" })).toBeTruthy();
  });

  test("validation issues are listed and block publishing", async () => {
    const broken = { ...sumo(), rep: { ...(sumo().rep as object), metric: "nope" } };
    open(broken);
    const box = await screen.findByRole("status", { name: "Düzeltilmesi gerekenler" });
    expect(box.textContent).toMatch(/rep/);
    expect((screen.getByRole("button", { name: "Yayınla" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the server's publish refusal is shown", async () => {
    const { t } = open(sumo(), { publishExercise: vi.fn(async () => Promise.reject(new ApiError(400, { error: "invalid_rule_pack", issues: ["rep: bad"] } as never))) });
    await trial(t, [{ kneeAngle: 80 }]);
    fireEvent.click(await screen.findByRole("button", { name: "Yayınla" }));
    expect(await screen.findByText(/Paket geçersiz: rep: bad/)).toBeTruthy();
  });

  test("the JSON view and the form show the same pack", async () => {
    open(sumo());
    fireEvent.click(await screen.findByRole("tab", { name: "JSON" }));
    const json = screen.getByLabelText("JSON") as HTMLTextAreaElement;
    expect(JSON.parse(json.value)).toEqual(sumo());
    fireEvent.change(json, { target: { value: JSON.stringify({ ...sumo(), name: { tr: "Geniş squat", en: "Wide squat" } }) } });
    fireEvent.click(screen.getByRole("tab", { name: "Form" }));
    expect((screen.getAllByLabelText("Ad (Türkçe)")[0] as HTMLInputElement).value).toBe("Geniş squat");
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    fireEvent.change(screen.getByLabelText("JSON"), { target: { value: "{ bozuk" } });
    expect(screen.getByText(/JSON okunamadı/)).toBeTruthy();
  });

  test("the condition builder writes the ready pose expression", async () => {
    const api = open(sumo());
    const ready = (await screen.findByText("Hazır duruşu")).closest("fieldset")!;
    fireEvent.change(within(ready).getByLabelText("1. koşul sağ Sayı"), { target: { value: "150" } });
    fireEvent.change(within(ready).getByLabelText("Süre (ms)"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(api.saveExerciseDraft).toHaveBeenCalled());
    const saved = (api.saveExerciseDraft.mock.calls[0] as unknown as [string, { readyPose: string }])[1];
    expect(saved.readyPose).toMatch(/150/);
    expect(saved.readyPose).toMatch(/for 800ms$/);
  });

  test("adding a fault gives a valid pack once named", async () => {
    const def = { ...sumo(), faults: [] };
    const api = open(def);
    fireEvent.click(await screen.findByRole("button", { name: "Hata ekle" }));
    const fault = screen.getByText("Hata 1").closest("fieldset")!;
    fireEvent.change(within(fault).getByLabelText("Ad (Türkçe)"), { target: { value: "Sığ" } });
    fireEvent.change(within(fault).getByLabelText("Ad (İngilizce)"), { target: { value: "Shallow" } });
    fireEvent.change(within(fault).getByLabelText("Uyarı (Türkçe)"), { target: { value: "Daha derin in" } });
    fireEvent.change(within(fault).getByLabelText("Uyarı (İngilizce)"), { target: { value: "Go deeper" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(api.saveExerciseDraft).toHaveBeenCalled());
    const saved = (api.saveExerciseDraft.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(safeLoadRulePack(saved).success).toBe(true);
    expect(saved.faults).toHaveLength(1);
  });

  test("live trial: the draft counts reps as in a session, and a change asks for a new trial", async () => {
    const { t } = open(sumo());
    await trial(t, [{ kneeAngle: 80 }, { kneeAngle: 80 }, { kneeAngle: 120 }]);
    expect(screen.getByLabelText("Sayılan tekrar").textContent).toBe("2");
    // the shallow third rep is counted as an attempt but not as a valid rep
    const [, faulty, incomplete] = /Geçerli 2 · hatalı (\d+) · yarım (\d+)/.exec(screen.getByLabelText("Canlı deneme").textContent ?? "")!;
    expect(Number(faulty) + Number(incomplete)).toBe(1);
    expect(screen.getByText(/Son deneme: (hatalı|yarım)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Yayınla" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Hedef: giriş"), { target: { value: "95" } });
    // the new rules start from zero
    expect(screen.getByLabelText("Sayılan tekrar").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await screen.findByText("Taslak kaydedildi.");
    expect((screen.getByRole("button", { name: "Yayınla" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("AC-11.7: the trial sends nothing and stores nothing", async () => {
    const api = open(sumo());
    await screen.findByRole("button", { name: "Denemeyi başlat" });
    const calls = () => [api.exerciseDraft, api.saveExerciseDraft, api.publishExercise, api.gymExercises].map((f) => f.mock.calls.length);
    const before = calls();
    const setItem = vi.spyOn(api.t.services.storage, "setItem");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await trial(api.t, [{ kneeAngle: 80 }]);
    expect(calls()).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

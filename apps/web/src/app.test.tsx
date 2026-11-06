import { PROGRAM_MESSAGE_KEYS } from "@gymspot/engine";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { App } from "./App";
import { createI18n, resources } from "./i18n";
import { SCREEN_ROUTES } from "./routes";

function renderAt(path: string, lng: "tr" | "en" = "tr") {
  const i18n = createI18n(lng);
  render(
    <MemoryRouter initialEntries={[path]}>
      <App i18n={i18n} />
    </MemoryRouter>,
  );
  return i18n;
}

/** All dotted keys of a nested translation object. */
function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(cleanup);

describe("i18n (CLAUDE.md: TR default, EN second)", () => {
  test("TR and EN define exactly the same keys", () => {
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources.tr.translation).sort());
  });

  test("every program engine message key is translated", () => {
    const tr = keys(resources.tr.translation);
    for (const key of Object.values(PROGRAM_MESSAGE_KEYS)) expect(tr, key).toContain(key);
  });

  test("every routed screen has a title", () => {
    const tr = keys(resources.tr.translation);
    for (const r of SCREEN_ROUTES) expect(tr).toContain(`screens.${r.screen}`);
  });

  test("Turkish is the default language", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Yönetim" })).toBeTruthy();
  });

  test("switching to English updates the UI and is remembered (AC-8.4)", () => {
    renderAt("/");
    fireEvent.change(screen.getByLabelText("Dil"), { target: { value: "en" } });
    expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
    expect(localStorage.getItem("gymspot.language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    cleanup();
    renderAt("/", createI18n().language as "en");
    expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
  });
});

describe("theme (AC-8.4)", () => {
  test("dark by default, switchable to light, remembered", () => {
    renderAt("/");
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => {
      fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "light" } });
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("gymspot.theme")).toBe("light");
    cleanup();
    renderAt("/");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("routes (specs/08)", () => {
  test.each(SCREEN_ROUTES.map((r) => [r.path.replace(":memberId", "m-1"), r.screen] as const))("%s renders %s", (path, id) => {
    renderAt(path);
    const el = document.querySelector(`[data-screen="${id}"]`);
    expect(el).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(resources.tr.translation.screens[id as keyof typeof resources.tr.translation.screens]);
  });

  test.each(["/admin/analytics", "/admin/billing", "/nope"])("%s is not routed (C7/C9 are outside the MVP)", (path) => {
    renderAt(path);
    expect(screen.getByRole("heading", { name: "Sayfa bulunamadı" })).toBeTruthy();
  });
});

describe("mandatory notices", () => {
  test.each(SCREEN_ROUTES.filter((r) => r.path.startsWith("/station")).map((r) => r.path))(
    "%s shows the medical disclaimer and the no-video notice (rule 5, specs/07)",
    (path) => {
      renderAt(path);
      expect(screen.getByText("Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur.")).toBeTruthy();
      expect(screen.getByText(/Görüntü saklanmaz/)).toBeTruthy();
    },
  );

  test.each(["/member/settings", "/admin/settings"])("settings screen %s shows the medical disclaimer", (path) => {
    renderAt(path);
    expect(screen.getByText("Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur.")).toBeTruthy();
  });
});

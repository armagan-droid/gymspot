import { describe, expect, test, vi } from "vitest";
import teep from "../../../exercises/teep.json";
import { RULE_PACKS, RULE_PACK_CACHE_KEY, applyRulePacks, rulePacks, syncRulePacks } from "./rules";

// T6.3: rule packs from the API, validated, cached for offline use.

const pack = (id: string, version = 1, patch: object = {}) => ({ ...teep, id, version, ...patch });
const memoryStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void m.set(k, v)), map: m };
};

describe("applyRulePacks", () => {
  test("a new pack from the server becomes available", () => {
    expect(applyRulePacks([pack("roundhouse_test")])).toEqual(["roundhouse_test"]);
    expect(RULE_PACKS.roundhouse_test?.pack.id).toBe("roundhouse_test");
    expect(rulePacks().roundhouse_test).toBeDefined();
  });

  test("invalid packs are skipped without breaking the others", () => {
    expect(applyRulePacks([{ id: "broken" }, pack("ok_after_broken")])).toEqual(["ok_after_broken"]);
    expect(RULE_PACKS.broken).toBeUndefined();
  });

  test("an older version never replaces a newer one", () => {
    applyRulePacks([pack("versioned_test", 2, { name: { tr: "v2", en: "v2" } })]);
    expect(applyRulePacks([pack("versioned_test", 1, { name: { tr: "v1", en: "v1" } })])).toEqual([]);
    expect(RULE_PACKS.versioned_test!.pack.name.tr).toBe("v2");
  });

  test("the plain view keeps its identity until something changes", () => {
    const before = rulePacks();
    applyRulePacks([pack("versioned_test", 2, { name: { tr: "v2", en: "v2" } })]); // unchanged
    expect(rulePacks()).toBe(before);
    applyRulePacks([pack("identity_test")]);
    expect(rulePacks()).not.toBe(before);
  });
});

describe("syncRulePacks", () => {
  test("fresh packs are applied and cached", async () => {
    const storage = memoryStorage();
    await syncRulePacks({ storage, fetch: async () => [{ id: "synced_test", version: 1, status: "draft", definition: pack("synced_test") }] });
    expect(RULE_PACKS.synced_test).toBeDefined();
    expect(JSON.parse(storage.map.get(RULE_PACK_CACHE_KEY)!)[0].id).toBe("synced_test");
  });

  test("offline: the cached packs are used and the cache is kept", async () => {
    const storage = memoryStorage({ [RULE_PACK_CACHE_KEY]: JSON.stringify([pack("cached_test")]) });
    await syncRulePacks({ storage, fetch: async () => Promise.reject(new Error("offline")) });
    expect(RULE_PACKS.cached_test).toBeDefined();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("signed out: nothing is fetched or written", async () => {
    const storage = memoryStorage();
    await syncRulePacks({ storage, fetch: async () => null });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("app start (T6.3)", () => {
  test("a station tablet refreshes packs as the device, a phone as the member", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { MemoryRouter } = await import("react-router");
    const { App } = await import("./App");
    const { createI18n } = await import("./i18n");
    const { testServices } = await import("./test-services");
    for (const [as, credentials] of [
      ["device", { device: { deviceId: "d", deviceToken: "x.y", tenantId: "t", stationId: "s" } }],
      ["member", { member: { accessToken: "a", refreshToken: "r" } }],
    ] as const) {
      const exercises = vi.fn(async () => [{ id: `${as}_pack`, version: 1, status: "draft", definition: pack(`${as}_pack`) }]);
      const t = testServices({ credentials, api: { exercises } });
      render(
        <MemoryRouter initialEntries={["/"]}>
          <App i18n={createI18n("tr")} services={t.services} />
        </MemoryRouter>,
      );
      await vi.waitFor(() => expect(RULE_PACKS[`${as}_pack`]).toBeDefined());
      expect(exercises).toHaveBeenCalledWith(as);
      cleanup();
    }
  });
});

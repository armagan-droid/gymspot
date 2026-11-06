import { describe, expect, test, vi } from "vitest";
import { installErrorReporting } from "./errors";

function target() {
  const t = new EventTarget();
  return t as unknown as Window;
}

describe("client error reporting (specs/02, 07)", () => {
  test("uncaught errors are reported scrubbed, with allowed tags only", async () => {
    const send = vi.fn(async () => undefined);
    const w = target();
    installErrorReporting(w, { send, tags: () => ({ route: "/station", release: "1.0.0" }) });
    const err = new Error("cannot sync for ayse@a.test");
    w.dispatchEvent(Object.assign(new Event("error"), { error: err, message: err.message }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: "cannot sync for [email]", tags: { route: "/station", release: "1.0.0" } }));
    expect(JSON.stringify(send.mock.calls)).not.toContain("ayse@a.test");
  });

  test("unhandled rejections are reported", () => {
    const send = vi.fn(async () => undefined);
    const w = target();
    installErrorReporting(w, { send, tags: () => ({}) });
    w.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("offline") }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
  });

  test("duplicates are suppressed and reports are rate limited", () => {
    const send = vi.fn(async () => undefined);
    const w = target();
    let now = 0;
    installErrorReporting(w, { send, tags: () => ({}), now: () => now, maxPerMinute: 3 });
    const fire = (m: string) => w.dispatchEvent(Object.assign(new Event("error"), { message: m }));
    fire("a");
    fire("a");
    fire("b");
    fire("c");
    fire("d");
    expect(send.mock.calls.map((c) => (c as unknown as [{ message: string }])[0].message)).toEqual(["a", "b", "c"]);
    now = 61_000;
    fire("a");
    expect(send).toHaveBeenCalledTimes(4);
  });

  test("a failing sender never throws into the page", () => {
    const w = target();
    installErrorReporting(w, { send: () => Promise.reject(new Error("down")), tags: () => ({}) });
    expect(() => w.dispatchEvent(Object.assign(new Event("error"), { message: "x" }))).not.toThrow();
  });

  test("uninstall removes the handlers", () => {
    const send = vi.fn(async () => undefined);
    const w = target();
    const off = installErrorReporting(w, { send, tags: () => ({}) });
    off();
    w.dispatchEvent(Object.assign(new Event("error"), { message: "x" }));
    expect(send).not.toHaveBeenCalled();
  });
});

import { describe, expect, test } from "vitest";
import { scrubErrorEvent, scrubText } from "../src/index";

describe("scrubText (specs/07: no PII in error reports)", () => {
  test("removes e-mails, phone numbers, JWTs and tenant tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcDEF123_-xyz";
    const tenantToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHE";
    const out = scrubText(`login failed for ayse.yilmaz@salon.com.tr tel +90 555 111 22 33 token ${jwt} refresh ${tenantToken}`);
    expect(out).not.toMatch(/ayse|555|eyJ|Zm9v/);
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[jwt]");
    expect(out).toContain("[token]");
  });

  test("keeps plain ids and messages", () => {
    expect(scrubText("set 3 failed for member a2000000-0000-4000-8000-000000000001")).toBe("set 3 failed for member a2000000-0000-4000-8000-000000000001");
  });

  test("truncates long text", () => {
    expect(scrubText("x".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("scrubErrorEvent", () => {
  test("keeps only allow-listed fields and tags", () => {
    const e = scrubErrorEvent({
      message: "boom for ayse@a.test",
      stack: "Error: boom\n    at f (https://app.test/assets/index.js:1:2)",
      tags: { route: "/station", release: "1.2.3", deviceKind: "tablet", email: "ayse@a.test" },
      user: { email: "ayse@a.test" },
      frame: { image: [] },
      extra: { anything: 1 },
    } as never);
    expect(e).toEqual({
      message: "boom for [email]",
      stack: "Error: boom\n    at f (https://app.test/assets/index.js:1:2)",
      tags: { route: "/station", release: "1.2.3", deviceKind: "tablet" },
    });
  });

  test("drops landmark-like numeric data from the context", () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    const e = scrubErrorEvent({ message: "m", context: { status: "SET_ACTIVE", counted: 3, points: landmarks, series: Array.from({ length: 50 }, (_, i) => i) } });
    expect(e.context).toEqual({ status: "SET_ACTIVE", counted: 3 });
  });

  test("context keeps only scalars and is limited in size", () => {
    const ctx: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) ctx[`k${i}`] = i;
    ctx.nested = { a: 1 };
    const e = scrubErrorEvent({ message: "m", context: ctx });
    expect(Object.keys(e.context ?? {})).toHaveLength(20);
    expect(e.context).not.toHaveProperty("nested");
  });

  test("a missing message becomes a placeholder", () => {
    expect(scrubErrorEvent({} as never).message).toBe("(no message)");
  });
});

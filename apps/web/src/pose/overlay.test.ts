import { squatFrame } from "@gymspot/engine/testing";
import { LANDMARK_NAMES } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { rulePack } from "../rules";
import { POSE_CONNECTIONS, overlayShapes, trackingGuide } from "./overlay";

const idx = (n: (typeof LANDMARK_NAMES)[number]) => LANDMARK_NAMES.indexOf(n);
const frame = squatFrame({ kneeAngle: 170 }, { view: "front" });
const hideAnkles = { ...frame, image: frame.image.map((p, i) => (i === idx("left_ankle") || i === idx("right_ankle") ? { ...p, visibility: 0.1 } : p)) };

describe("overlayShapes (specs/08 A3/A5)", () => {
  test("no person → nothing to draw", () => {
    expect(overlayShapes(null, { minVisibility: 0.5 })).toEqual({ lines: [], points: [] });
  });

  test("a fully visible person gets every body connection", () => {
    const s = overlayShapes(frame, { minVisibility: 0.5 });
    expect(s.lines).toHaveLength(POSE_CONNECTIONS.length);
    expect(s.points.every((p) => p.state === "ok")).toBe(true);
  });

  test("hidden required landmarks are marked missing; their bones are not drawn", () => {
    const required = [idx("left_ankle"), idx("right_ankle"), idx("left_hip")];
    const s = overlayShapes(hideAnkles, { minVisibility: 0.5, required });
    expect(s.points.filter((p) => p.state === "missing")).toHaveLength(2);
    expect(s.lines.length).toBeLessThan(POSE_CONNECTIONS.length);
  });

  test("hidden landmarks that are not required are simply left out", () => {
    const s = overlayShapes(hideAnkles, { minVisibility: 0.5 });
    expect(s.points.some((p) => p.state === "missing")).toBe(false);
  });
});

describe("trackingGuide: the setup drawing returns when the person is out of view (specs/08 A5)", () => {
  test("nobody in view: silhouette and guide frame, no red bands", () => {
    const g = trackingGuide(rulePack("squat"), { view: "front", nearSide: "left" }, null);
    expect(g.target).toBe("standing");
    expect(g.guide).toEqual({ margin: 0.02, ready: false });
    expect(g.edges).toEqual([]);
  });

  test("feet below the picture: red band at the bottom, the near side's landmarks required", () => {
    const low = { ...frame, image: frame.image.map((p) => ({ ...p, y: p.y + 0.2 })) };
    const g = trackingGuide(rulePack("squat"), { view: "side", nearSide: "right" }, low);
    expect(g.edges).toContain("bottom");
    expect(g.required).toContain(idx("right_ankle"));
    expect(g.required).not.toContain(idx("left_ankle"));
  });

  test("a horizontal exercise gets the plank silhouette", () => {
    expect(trackingGuide(rulePack("pushup"), { view: "side", nearSide: "left" }, null).target).toBe("horizontal");
  });
});

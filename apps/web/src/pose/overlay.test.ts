import { evaderFrame, squatFrame } from "@gymspot/engine/testing";
import { LANDMARK_NAMES } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { rulePack } from "../rules";
import { HeadTargetTracker, POSE_CONNECTIONS, overlayShapes, trackingGuide } from "./overlay";

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

describe("HeadTargetTracker: the eskiv target circle (specs/04 Eskiv, 08 A5)", () => {
  const front = (p: Parameters<typeof evaderFrame>[0]) => evaderFrame(p, { view: "front" });

  test("only head-movement drills get a target", () => {
    expect(HeadTargetTracker.for(rulePack("squat"))).toBeNull();
    expect(HeadTargetTracker.for(rulePack("slip"))).not.toBeNull();
  });

  test("the circle sits on the resting head and stays there while the head slips out of it", () => {
    const t = HeadTargetTracker.for(rulePack("slip"))!;
    const home = t.update(front({}), 1)!;
    expect(home.center.x).toBeCloseTo(front({}).image[0]!.x, 6);
    expect(home.hit).toBe(false);
    const out = t.update(front({ slip: 25 }), 1)!;
    expect(out.center).toEqual(home.center); // the home does not follow a slip
    expect(out.hit).toBe(true);
    expect(Math.abs(out.head.x - out.center.x)).toBeGreaterThan(out.radius);
    // a half slip stays inside the circle and is not a hit
    const half = t.update(front({ slip: 10 }), 1)!;
    expect(half.hit).toBe(false);
    expect(Math.abs(half.head.x - half.center.x)).toBeLessThan(half.radius);
  });

  test("duck: the line is below the head, a deep duck crosses it", () => {
    const t = HeadTargetTracker.for(rulePack("duck"))!;
    const home = t.update(front({}), 1)!;
    expect(home.duckY).toBeGreaterThan(home.center.y);
    expect(home.radius).toBeCloseTo(home.duckY! - home.center.y, 6);
    // synthetic frames are hip-centered; a real camera keeps the feet where they are
    const ankleY = (f: ReturnType<typeof front>) => f.image[idx("left_ankle")]!.y;
    const duck = front({ kneeAngle: 110, torsoLean: 25 });
    const dy = ankleY(front({})) - ankleY(duck);
    const deep = t.update({ ...duck, image: duck.image.map((p) => ({ ...p, y: p.y + dy })) }, 1)!;
    expect(deep.hit).toBe(true);
    expect(deep.head.y).toBeGreaterThan(deep.duckY!);
  });

  describe("guide markers: where to move the head next (specs/08 A5)", () => {
    const leftward = (f: ReturnType<typeof front>) => Math.sign(f.image[idx("left_shoulder")]!.x - f.image[idx("right_shoulder")]!.x);
    const goal = (t: NonNullable<ReturnType<HeadTargetTracker["update"]>>, side: string) => t.goals.find((g) => g.side === side)!;

    test("a slip drill has a target bubble on each side, outside the circle, on the person's own left and right", () => {
      const home = HeadTargetTracker.for(rulePack("slip"))!.update(front({}), 1)!;
      expect(home.goals.map((g) => g.side).sort()).toEqual(["left", "right"]);
      const dir = leftward(front({}));
      expect(Math.sign(goal(home, "left").at.x - home.center.x)).toBe(dir);
      expect(Math.sign(goal(home, "right").at.x - home.center.x)).toBe(-dir);
      for (const g of home.goals) {
        expect(Math.abs(g.at.x - home.center.x)).toBeGreaterThan(home.radius);
        expect(g.at.y).toBeCloseTo(home.center.y, 6);
      }
    });

    test("go → back → go: the arrow points at the next target, then home, and the sides alternate", () => {
      const t = HeadTargetTracker.for(rulePack("slip"))!;
      const home = t.update(front({}), 1)!;
      expect(home.phase).toBe("go");
      expect(goal(home, "left").next).toBe(true); // first target: the person's left
      expect(goal(home, "right").next).toBe(false);
      expect(home.arrow).toEqual({ from: home.head, to: goal(home, "left").at });
      // a half slip is still on the way
      expect(t.update(front({ slip: 10 }), 1)!.phase).toBe("go");
      const out = t.update(front({ slip: 25 }), 1)!;
      expect(out.phase).toBe("back");
      expect(out.arrow).toEqual({ from: out.head, to: out.center });
      const back = t.update(front({}), 1)!;
      expect(back.phase).toBe("go");
      expect(goal(back, "right").next).toBe(true);
      expect(back.arrow!.to).toEqual(goal(back, "right").at);
    });

    test("a slip to the wrong side does not skip the turn", () => {
      const t = HeadTargetTracker.for(rulePack("slip"))!;
      t.update(front({}), 1);
      t.update(front({ slip: -25 }), 1); // to the right while the left was next
      expect(goal(t.update(front({}), 1)!, "left").next).toBe(true);
    });

    test("a one-sided drill always points at its own side", () => {
      const t = HeadTargetTracker.for(rulePack("slip_right"))!;
      const home = t.update(front({}), 1)!;
      expect(home.goals.map((g) => g.side)).toEqual(["right"]);
      expect(Math.sign(home.goals[0]!.at.x - home.center.x)).toBe(-leftward(front({})));
      t.update(front({ slip: -25 }), 1);
      const again = t.update(front({}), 1)!;
      expect(again.phase).toBe("go");
      expect(again.goals[0]!.next).toBe(true);
    });

    test("duck: the target bubble is below the dashed line", () => {
      const home = HeadTargetTracker.for(rulePack("duck"))!.update(front({}), 1)!;
      expect(home.goals).toHaveLength(1);
      expect(home.goals[0]!.side).toBe("down");
      expect(home.goals[0]!.at.y).toBeGreaterThan(home.duckY!);
      expect(home.goals[0]!.at.x).toBeCloseTo(home.center.x, 6);
      expect(home.arrow!.to).toEqual(home.goals[0]!.at);
    });
  });

  test("no person, no target", () => {
    expect(HeadTargetTracker.for(rulePack("slip"))!.update(null, 1)).toBeNull();
  });
});

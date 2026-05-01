import { describe, expect, it } from "vitest";
import { simplifyStroke, strokePathD } from "./stroke";
import type { Vec2 } from "./types";

describe("simplifyStroke", () => {
  it("returns a copy when fewer than 3 points", () => {
    expect(simplifyStroke([], 1)).toEqual([]);
    expect(simplifyStroke([[1, 2]], 1)).toEqual([[1, 2]]);
    expect(
      simplifyStroke(
        [
          [0, 0],
          [10, 10],
        ],
        1,
      ),
    ).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it("keeps endpoints", () => {
    const pts: Vec2[] = [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [3, 0.001],
      [10, 0],
    ];
    const out = simplifyStroke(pts, 0.5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
  });

  it("drops collinear interior points within epsilon", () => {
    const pts: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(simplifyStroke(pts, 0.5)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it("keeps a corner point that exceeds epsilon", () => {
    const pts: Vec2[] = [
      [0, 0],
      [5, 5],
      [10, 0],
    ];
    expect(simplifyStroke(pts, 0.5)).toEqual([
      [0, 0],
      [5, 5],
      [10, 0],
    ]);
  });

  it("approximates a noisy line back to its endpoints", () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 100; i++) {
      pts.push([i, Math.sin(i * 0.01) * 0.1]); // <0.5 amplitude
    }
    const out = simplifyStroke(pts, 0.5);
    expect(out.length).toBeLessThan(10);
  });

  it("handles duplicate consecutive points (zero-length segment)", () => {
    const pts: Vec2[] = [
      [0, 0],
      [0, 0],
      [10, 0],
    ];
    const out = simplifyStroke(pts, 0.5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
  });

  it("does not mutate the input array", () => {
    const pts: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const snapshot = JSON.stringify(pts);
    simplifyStroke(pts, 0.1);
    expect(JSON.stringify(pts)).toBe(snapshot);
  });
});

describe("strokePathD", () => {
  it("returns empty string for fewer than 2 points", () => {
    expect(strokePathD([])).toBe("");
    expect(strokePathD([[1, 2]])).toBe("");
  });

  it("two points → M…L… line", () => {
    expect(
      strokePathD([
        [0, 0],
        [10, 5],
      ]),
    ).toBe("M0,0 L10,5");
  });

  it("three+ points → quadratic Beziers ending in a final L", () => {
    const d = strokePathD([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expect(d.startsWith("M0,0 ")).toBe(true);
    expect(d).toContain("Q10,0 15,0");
    expect(d.endsWith("L20,0")).toBe(true);
  });

  it("rounds coordinates to 2 decimal places", () => {
    const d = strokePathD([
      [1.234567, 2.345678],
      [3.456789, 4.567891],
    ]);
    expect(d).toBe("M1.23,2.35 L3.46,4.57");
  });
});

import { describe, expect, it } from "vitest";
import {
  polygonAnchor,
  polygonPointsForSides,
  polygonVerticesFor,
  scaleVertex,
} from "./polygon";
import type { Box2D, Vec2 } from "./types";

const square: Box2D = { x: 100, y: 100, width: 100, height: 100 };

describe("polygonVerticesFor", () => {
  it("triangle is isoceles with apex up and base on the bottom edge", () => {
    expect(polygonVerticesFor(3)).toEqual([
      [50, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it("rectangle (4) is a unit square centred on the unit box", () => {
    const v = polygonVerticesFor(4);
    expect(v).toHaveLength(4);
    // First vertex is the top one (angle = -π/2): y must be 0.
    expect(v[0]![1]).toBeCloseTo(0);
  });

  it("hexagon has 6 distinct vertices on a unit circle", () => {
    const v = polygonVerticesFor(6);
    expect(v).toHaveLength(6);
    for (const [x, y] of v) {
      const dx = x - 50;
      const dy = y - 50;
      expect(Math.hypot(dx, dy)).toBeCloseTo(50, 5);
    }
  });

  it("first vertex is always at the top (y ≈ 0) for regular polygons", () => {
    for (const sides of [4, 5, 6] as const) {
      const v = polygonVerticesFor(sides);
      expect(v[0]![1]).toBeCloseTo(0, 5);
    }
  });
});

describe("polygonPointsForSides", () => {
  it("returns a space-separated points string with 2 decimals", () => {
    const s = polygonPointsForSides(4);
    const points = s.split(" ");
    expect(points).toHaveLength(4);
    for (const p of points) {
      expect(p).toMatch(/^-?\d+\.\d{2},-?\d+\.\d{2}$/);
    }
  });
});

describe("scaleVertex", () => {
  it("maps (0, 0) to the box top-left", () => {
    expect(scaleVertex(square, [0, 0])).toEqual([100, 100]);
  });

  it("maps (100, 100) to the box bottom-right", () => {
    expect(scaleVertex(square, [100, 100])).toEqual([200, 200]);
  });

  it("maps (50, 50) to the box centre", () => {
    expect(scaleVertex(square, [50, 50])).toEqual([150, 150]);
  });
});

describe("polygonAnchor", () => {
  it("returns null when target coincides with the centre", () => {
    expect(polygonAnchor(square, 4, [150, 150])).toBeNull();
  });

  it("ray straight up from a square's centre lands on the top edge", () => {
    const hit = polygonAnchor(square, 4, [150, -1000]);
    expect(hit).not.toBeNull();
    const [x, y] = hit as Vec2;
    expect(x).toBeCloseTo(150, 5);
    expect(y).toBeCloseTo(100, 5);
  });

  it("ray straight right from a square's centre lands on the right edge", () => {
    const hit = polygonAnchor(square, 4, [1000, 150]);
    expect(hit).not.toBeNull();
    const [x, y] = hit as Vec2;
    expect(x).toBeCloseTo(200, 5);
    expect(y).toBeCloseTo(150, 5);
  });

  it("triangle: ray straight up lands at the apex", () => {
    const hit = polygonAnchor(square, 3, [150, -1000]);
    expect(hit).not.toBeNull();
    const [x, y] = hit as Vec2;
    expect(x).toBeCloseTo(150, 5);
    expect(y).toBeCloseTo(100, 5); // top of bounding box, the triangle's apex
  });

  it("triangle: ray straight down lands on the base (bottom edge)", () => {
    const hit = polygonAnchor(square, 3, [150, 1000]);
    expect(hit).not.toBeNull();
    expect(hit![1]).toBeCloseTo(200, 5);
  });

  it("hexagon: every cardinal direction lands inside the bounding box", () => {
    for (const dir of [
      [1000, 150],
      [-1000, 150],
      [150, 1000],
      [150, -1000],
    ] as const) {
      const hit = polygonAnchor(square, 6, dir);
      expect(hit).not.toBeNull();
      const [x, y] = hit!;
      expect(x).toBeGreaterThanOrEqual(99.999);
      expect(x).toBeLessThanOrEqual(200.001);
      expect(y).toBeGreaterThanOrEqual(99.999);
      expect(y).toBeLessThanOrEqual(200.001);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  HANDLE_CODES,
  handleAnchor,
  nearestHandle,
  rectAnchor,
} from "./handle";
import type { Box2D } from "./types";

const box: Box2D = { x: 100, y: 100, width: 100, height: 50 };

describe("handleAnchor", () => {
  it("corners sit at box vertices", () => {
    expect(handleAnchor(box, "tl")).toEqual([100, 100]);
    expect(handleAnchor(box, "tr")).toEqual([200, 100]);
    expect(handleAnchor(box, "bl")).toEqual([100, 150]);
    expect(handleAnchor(box, "br")).toEqual([200, 150]);
  });

  it("edge handles sit at side midpoints", () => {
    expect(handleAnchor(box, "t")).toEqual([150, 100]);
    expect(handleAnchor(box, "r")).toEqual([200, 125]);
    expect(handleAnchor(box, "b")).toEqual([150, 150]);
    expect(handleAnchor(box, "l")).toEqual([100, 125]);
  });
});

describe("HANDLE_CODES", () => {
  it("contains exactly the eight handle codes", () => {
    expect(HANDLE_CODES.length).toBe(8);
    expect(new Set(HANDLE_CODES)).toEqual(
      new Set(["t", "r", "b", "l", "tl", "tr", "bl", "br"]),
    );
  });
});

describe("nearestHandle", () => {
  it("picks the right midpoint when target is far to the right", () => {
    expect(nearestHandle(box, [10000, 125])).toBe("r");
  });

  it("picks the top midpoint when target is far above", () => {
    expect(nearestHandle(box, [150, -10000])).toBe("t");
  });

  it("picks a corner when the target is in that diagonal", () => {
    expect(nearestHandle(box, [10000, -10000])).toBe("tr");
  });
});

describe("rectAnchor", () => {
  it("uses the supplied handle code when valid", () => {
    expect(rectAnchor(box, "tl", [0, 0])).toEqual([100, 100]);
    expect(rectAnchor(box, "br", [0, 0])).toEqual([200, 150]);
  });

  it("falls back to nearestHandle when the code is null/undefined/empty", () => {
    expect(rectAnchor(box, null, [10000, 125])).toEqual([200, 125]); // r
    expect(rectAnchor(box, undefined, [10000, 125])).toEqual([200, 125]);
    expect(rectAnchor(box, "", [10000, 125])).toEqual([200, 125]);
  });

  it("falls back to nearestHandle when the code is unrecognised", () => {
    expect(rectAnchor(box, "garbage", [10000, 125])).toEqual([200, 125]);
  });
});

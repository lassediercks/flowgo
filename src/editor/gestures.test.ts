import { describe, expect, it } from "vitest";
import { classifyTap, isKeyboardResize, movedBeyond } from "./gestures.ts";

describe("classifyTap", () => {
  it("first tap is always single", () => {
    const r = classifyTap(null, { id: "a", time: 100 }, 300);
    expect(r.kind).toBe("single");
    expect(r.nextLastTap).toEqual({ id: "a", time: 100 });
  });

  it("two taps on the same id within window become a double", () => {
    const r = classifyTap(
      { id: "a", time: 100 },
      { id: "a", time: 350 },
      300,
    );
    expect(r.kind).toBe("double");
    // After a double, the lastTap baseline is cleared so a third tap
    // doesn't promote into another double.
    expect(r.nextLastTap).toBeNull();
  });

  it("two taps on the same id outside the window do not double", () => {
    const r = classifyTap(
      { id: "a", time: 100 },
      { id: "a", time: 401 },
      300,
    );
    expect(r.kind).toBe("single");
    expect(r.nextLastTap).toEqual({ id: "a", time: 401 });
  });

  it("two taps on different ids do not double", () => {
    const r = classifyTap(
      { id: "a", time: 100 },
      { id: "b", time: 200 },
      300,
    );
    expect(r.kind).toBe("single");
    expect(r.nextLastTap).toEqual({ id: "b", time: 200 });
  });

  it("exactly at the boundary still counts as double", () => {
    const r = classifyTap(
      { id: "x", time: 0 },
      { id: "x", time: 300 },
      300,
    );
    expect(r.kind).toBe("double");
  });
});

describe("movedBeyond", () => {
  it("zero movement is not beyond any positive tolerance", () => {
    expect(movedBeyond(10, 10, 10, 10, 4)).toBe(false);
  });

  it("movement exactly at the tolerance does not exceed it", () => {
    // 3-4-5 triangle: distance is exactly 5
    expect(movedBeyond(0, 0, 3, 4, 5)).toBe(false);
  });

  it("movement just past the tolerance counts", () => {
    expect(movedBeyond(0, 0, 4, 4, 4)).toBe(true);
  });

  it("works in any direction", () => {
    expect(movedBeyond(100, 100, 90, 90, 4)).toBe(true);
    expect(movedBeyond(100, 100, 102, 102, 4)).toBe(false);
  });
});

describe("isKeyboardResize", () => {
  it("URL-bar collapse is below the threshold", () => {
    // iOS Safari URL bar is ~50–90px; pick something representative.
    expect(isKeyboardResize(800, 720, 150)).toBe(false);
  });

  it("soft keyboard exceeds the threshold", () => {
    // Soft keyboard typically claims 260–340px.
    expect(isKeyboardResize(800, 540, 150)).toBe(true);
  });

  it("equality at the threshold is not a keyboard", () => {
    expect(isKeyboardResize(800, 650, 150)).toBe(false);
  });

  it("default threshold of 150px applies", () => {
    expect(isKeyboardResize(800, 600)).toBe(true);
    expect(isKeyboardResize(800, 700)).toBe(false);
  });
});

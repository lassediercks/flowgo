import { describe, expect, it } from "vitest";
import { boxSides, isValidSides } from "./sides";

describe("isValidSides", () => {
  it("accepts 3, 4, 5, 6", () => {
    expect(isValidSides(3)).toBe(true);
    expect(isValidSides(4)).toBe(true);
    expect(isValidSides(5)).toBe(true);
    expect(isValidSides(6)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidSides(0)).toBe(false);
    expect(isValidSides(2)).toBe(false);
    expect(isValidSides(7)).toBe(false);
    expect(isValidSides(3.5)).toBe(false);
    expect(isValidSides("4")).toBe(false);
    expect(isValidSides(null)).toBe(false);
    expect(isValidSides(undefined)).toBe(false);
  });
});

describe("boxSides", () => {
  it("defaults to 4 (rectangle) when sides is missing", () => {
    expect(boxSides({})).toBe(4);
  });

  it("defaults to 4 when sides is the rectangle marker (4) or 0", () => {
    expect(boxSides({ sides: 4 })).toBe(4);
    expect(boxSides({ sides: 0 })).toBe(4);
  });

  it("returns the explicit side count for triangle / pentagon / hexagon", () => {
    expect(boxSides({ sides: 3 })).toBe(3);
    expect(boxSides({ sides: 5 })).toBe(5);
    expect(boxSides({ sides: 6 })).toBe(6);
  });

  it("falls back to 4 for nonsense values", () => {
    expect(boxSides({ sides: 2 })).toBe(4);
    expect(boxSides({ sides: 7 })).toBe(4);
    expect(boxSides({ sides: -1 })).toBe(4);
    expect(boxSides({ sides: NaN })).toBe(4);
  });
});

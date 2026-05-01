import { describe, expect, it } from "vitest";
import {
  isValidFont,
  isValidPalette,
  resolveFont,
  resolvePalette,
} from "./palette";

describe("isValidPalette / isValidFont", () => {
  it("accepts 1..9", () => {
    for (let i = 1; i <= 9; i++) {
      expect(isValidPalette(i)).toBe(true);
      expect(isValidFont(i)).toBe(true);
    }
  });

  it("rejects 0, negative, >9, fractional, non-numbers", () => {
    expect(isValidPalette(0)).toBe(false);
    expect(isValidPalette(-1)).toBe(false);
    expect(isValidPalette(10)).toBe(false);
    expect(isValidPalette(2.5)).toBe(false);
    expect(isValidPalette("3")).toBe(false);
    expect(isValidPalette(null)).toBe(false);
    expect(isValidPalette(undefined)).toBe(false);
  });
});

describe("resolvePalette / resolveFont", () => {
  it("returns 1 for missing / default values", () => {
    expect(resolvePalette(undefined)).toBe(1);
    expect(resolvePalette(null)).toBe(1);
    expect(resolvePalette(0)).toBe(1);
    expect(resolvePalette(1)).toBe(1);
    expect(resolveFont(undefined)).toBe(1);
  });

  it("returns the explicit index for 2..9", () => {
    for (let i = 2; i <= 9; i++) {
      expect(resolvePalette(i)).toBe(i);
      expect(resolveFont(i)).toBe(i);
    }
  });

  it("falls back to 1 for out-of-range values", () => {
    expect(resolvePalette(10)).toBe(1);
    expect(resolvePalette(-1)).toBe(1);
    expect(resolvePalette(2.7)).toBe(1);
  });
});

// Palette and font-size scales: 1 means "default" (no class applied);
// 2..9 are the styled variants. We persist 0 in some legacy positions
// to mean "default", so accept either 0 or 1 as the no-op value.

export type PaletteIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type FontIndex = PaletteIndex;

export const isValidPalette = (n: unknown): n is PaletteIndex =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9;

export const isValidFont = (n: unknown): n is FontIndex => isValidPalette(n);

// Resolve a stored palette field (which might be undefined / 0 / 1 for
// "default") to the rendering index. Returns 1 for any non-styled value
// so the caller can short-circuit class application.
export const resolvePalette = (
  v: number | undefined | null,
): PaletteIndex => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 2 && v <= 9) {
    return v as PaletteIndex;
  }
  return 1;
};

export const resolveFont = (v: number | undefined | null): FontIndex =>
  resolvePalette(v);

// Sides validation: only 3 (triangle), 4 (rectangle, default),
// 5 (pentagon), 6 (hexagon) are valid. 0 means "default" in stored
// data and resolves to 4 here.

import type { Sides } from "./types";

export const isValidSides = (n: unknown): n is Sides =>
  n === 3 || n === 4 || n === 5 || n === 6;

export const boxSides = (b: { readonly sides?: number | undefined }): Sides => {
  const n = b.sides;
  if (n === 3 || n === 5 || n === 6) return n;
  return 4;
};

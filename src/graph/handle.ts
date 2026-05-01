// Edge-anchor math for rectangular boxes. Each of the eight handle
// codes (top, right, bottom, left, four corners) maps to a fixed point
// on the box outline. Pure functions over Box2D — no DOM access.

import type { Box2D, Vec2 } from "./types";

export type HandleCode = "t" | "r" | "b" | "l" | "tl" | "tr" | "bl" | "br";

export const HANDLE_CODES: readonly HandleCode[] = [
  "t", "r", "b", "l", "tl", "tr", "bl", "br",
];

const isHandleCode = (s: string): s is HandleCode =>
  s === "t" || s === "r" || s === "b" || s === "l" ||
  s === "tl" || s === "tr" || s === "bl" || s === "br";

// Anchor point for a handle code on a rectangle. Corners sit at the
// box vertices; edge handles sit at the midpoints of each side.
export const handleAnchor = (box: Box2D, code: HandleCode): Vec2 => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (code) {
    case "t":  return [cx, box.y];
    case "b":  return [cx, box.y + box.height];
    case "l":  return [box.x, cy];
    case "r":  return [box.x + box.width, cy];
    case "tl": return [box.x, box.y];
    case "tr": return [box.x + box.width, box.y];
    case "bl": return [box.x, box.y + box.height];
    case "br": return [box.x + box.width, box.y + box.height];
  }
};

// Pick the handle whose anchor is closest to (fx, fy). Used when an
// edge has no stored handle preference and we need to pick one that
// looks reasonable for the geometry.
export const nearestHandle = (box: Box2D, target: Vec2): HandleCode => {
  let best: HandleCode = "r";
  let bestD = Infinity;
  for (const code of HANDLE_CODES) {
    const [hx, hy] = handleAnchor(box, code);
    const d = Math.hypot(hx - target[0], hy - target[1]);
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
};

// Resolve an edge endpoint to a screen-space point. If `code` is
// supplied and valid, use that handle directly; otherwise pick the
// nearest handle to the other end of the edge.
export const rectAnchor = (
  box: Box2D,
  code: string | null | undefined,
  target: Vec2,
): Vec2 => {
  const c = code && isHandleCode(code) ? code : nearestHandle(box, target);
  return handleAnchor(box, c);
};

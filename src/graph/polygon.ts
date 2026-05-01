// Polygon geometry for shaped boxes, expressed as pure functions over
// a 0..100 unit-box and a separate screen-space mapper. Every helper
// in this file is deterministic and side-effect-free; render code
// supplies dimensions, math returns coordinates.

import type { Box2D, Sides, Vec2 } from "./types";

const TAU = Math.PI * 2;

// Vertices in 0..100 unit-box space, anchored so the first vertex is
// at the top centre. Triangles are isoceles with apex up and the base
// flush with the bottom edge so the rendering looks intentional.
export const polygonVerticesFor = (sides: Sides): readonly Vec2[] => {
  if (sides === 3) {
    return Object.freeze([
      [50, 0] as const,
      [100, 100] as const,
      [0, 100] as const,
    ]);
  }
  const verts: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (TAU * i) / sides;
    verts.push([50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a)]);
  }
  return verts;
};

// SVG `points` attribute string with 2-decimal precision so the
// serialised path stays compact without losing visible quality.
export const polygonPointsForSides = (sides: Sides): string =>
  polygonVerticesFor(sides)
    .map(([x, y]) => `${round2(x)},${round2(y)}`)
    .join(" ");

// Scale a unit-box vertex into a screen-space coordinate inside `box`.
export const scaleVertex = (box: Box2D, v: Vec2): Vec2 => {
  const [ux, uy] = v;
  return [box.x + (ux / 100) * box.width, box.y + (uy / 100) * box.height];
};

// Ray-cast from the box centre toward `target`; return the point where
// the ray first crosses a polygon edge. Returns `null` only for the
// degenerate case where centre and target coincide (caller falls back
// to the centre itself, which is equivalent visually).
export const polygonAnchor = (
  box: Box2D,
  sides: Sides,
  target: Vec2,
): Vec2 | null => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const [tx, ty] = target;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return null;

  const verts = polygonVerticesFor(sides).map((v) => scaleVertex(box, v));
  let bestT = Infinity;
  let hit: Vec2 | null = null;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const sx = b[0] - a[0];
    const sy = b[1] - a[1];
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-9) continue; // ray is parallel to this edge
    const t = ((a[0] - cx) * sy - (a[1] - cy) * sx) / denom;
    const u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / denom;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      hit = [cx + dx * t, cy + dy * t];
    }
  }
  return hit;
};

const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

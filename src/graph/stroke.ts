// Brush-stroke utilities. Two functions: simplify a polyline by
// dropping points that lie within `eps` of the chord between their
// neighbours (Ramer-Douglas-Peucker), and convert a point list to an
// SVG path that draws a smooth curve through the points (quadratic
// Beziers via midpoints).

import type { Vec2 } from "./types";

export const simplifyStroke = (
  points: readonly Vec2[],
  eps: number,
): Vec2[] => {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const eps2 = eps * eps;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<readonly [number, number]> = [
    [0, points.length - 1],
  ];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const a = points[lo]!;
    const b = points[hi]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let maxD2 = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i]!;
      let d2: number;
      if (len2 === 0) {
        const ex = p[0] - a[0];
        const ey = p[1] - a[1];
        d2 = ex * ex + ey * ey;
      } else {
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
        const cx = a[0] + t * dx;
        const cy = a[1] + t * dy;
        const ex = p[0] - cx;
        const ey = p[1] - cy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD2) {
        maxD2 = d2;
        idx = i;
      }
    }
    if (idx >= 0 && maxD2 > eps2) {
      keep[idx] = true;
      stack.push([lo, idx]);
      stack.push([idx, hi]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push([points[i]![0], points[i]![1]]);
  }
  return out;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const strokePathD = (points: readonly Vec2[]): string => {
  if (points.length < 2) return "";
  const first = points[0]!;
  if (points.length === 2) {
    const last = points[1]!;
    return `M${round2(first[0])},${round2(first[1])} L${round2(last[0])},${round2(last[1])}`;
  }
  let d = `M${round2(first[0])},${round2(first[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    d += ` Q${round2(p1[0])},${round2(p1[1])} ${round2(mx)},${round2(my)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${round2(last[0])},${round2(last[1])}`;
  return d;
};

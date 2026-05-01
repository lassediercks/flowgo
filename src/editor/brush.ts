// Brush mode: free-hand stroke painting on the background. Owns the
// `brushMode` toggle and the in-flight `activeStroke`. main.ts reads
// `isBrushMode()` and `isPainting()` to gate other interactions, and
// dispatches mousedown/move/up to the start/extend/finish trio.

import { simplifyStroke } from "../index.ts";
import { toDataX, toDataY } from "./viewport.ts";

interface ActiveStroke {
  readonly id: string;
  points: Array<readonly [number, number]>;
  readonly polyEl: SVGPolylineElement;
}

interface BrushBindings {
  readonly mintId: () => string;
  readonly strokeLayer: () => SVGGElement;
  readonly currentMap: () => { strokes?: Array<unknown> };
  readonly scheduleSave: () => void;
  readonly afterCommit: () => void; // call renderStrokes
  readonly setStatus: (s: string) => void;
}

let bindings: BrushBindings | null = null;
export const wireBrush = (b: BrushBindings): void => {
  bindings = b;
};
const must = (): BrushBindings => {
  if (!bindings) throw new Error("brush: wireBrush() not called");
  return bindings;
};

let brushMode = false;
let active: ActiveStroke | null = null;

export const isBrushMode = (): boolean => brushMode;
export const isPainting = (): boolean => active !== null;

export const setBrushMode = (on: boolean): void => {
  if (brushMode === on) return;
  brushMode = on;
  document.body.classList.toggle("brush-mode", brushMode);
  must().setStatus(brushMode ? "brush mode — drag to paint, V to exit" : "select mode");
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const previewPoints = (pts: ReadonlyArray<readonly [number, number]>): string =>
  pts.map((p) => `${p[0]},${p[1]}`).join(" ");

export const startStroke = (e: MouseEvent): void => {
  e.preventDefault();
  e.stopPropagation();
  const x = round2(toDataX(e.clientX));
  const y = round2(toDataY(e.clientY));
  const id = must().mintId();
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "stroke-group");
  g.dataset["id"] = id;
  const poly = document.createElementNS(ns, "polyline");
  poly.setAttribute("class", "stroke-line");
  poly.setAttribute("points", `${x},${y}`);
  g.appendChild(poly);
  must().strokeLayer().appendChild(g);
  active = { id, points: [[x, y]], polyEl: poly };
};

export const extendStroke = (e: MouseEvent): void => {
  if (!active) return;
  const x = round2(toDataX(e.clientX));
  const y = round2(toDataY(e.clientY));
  const last = active.points[active.points.length - 1]!;
  if (Math.hypot(x - last[0], y - last[1]) < 2) return;
  active.points.push([x, y]);
  active.polyEl.setAttribute("points", previewPoints(active.points));
};

export const finishStroke = (): void => {
  if (!active) return;
  // ε ≈ 1.5px — drops hand-tremor samples without rounding intentional curves.
  const simplified = simplifyStroke(active.points, 1.5);
  if (simplified.length >= 2) {
    const m = must().currentMap();
    (m.strokes ??= []).push({ id: active.id, points: simplified });
    must().scheduleSave();
  } else {
    const g = active.polyEl.parentNode;
    if (g && g.parentNode) g.parentNode.removeChild(g);
  }
  active = null;
  must().afterCommit();
};

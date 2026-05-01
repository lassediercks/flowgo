// Viewport: pan offset + the small bundle of helpers that translate
// between screen and canvas-data coordinates and reposition every
// canvas-aligned SVG layer when the viewport moves.
//
// The viewport object is exported as a stable mutable reference so
// pan / drag / undo handlers can write to `viewport.x` / `.y` and
// then call applyViewport() to redraw — keeps the live-binding
// semantics callers expect from the previous module-global.

export const viewport: { x: number; y: number } = { x: 0, y: 0 };

export const toDataX = (clientX: number): number => clientX - viewport.x;
export const toDataY = (clientY: number): number => clientY - viewport.y;

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`viewport: missing #${id}`);
  return el;
};

export const applyViewport = (): void => {
  const tx = viewport.x;
  const ty = viewport.y;
  byId("canvas").style.transform = `translate(${tx}px, ${ty}px)`;
  for (const layer of ["line-layer", "stroke-layer", "edge-layer"]) {
    byId(layer).setAttribute("transform", `translate(${tx} ${ty})`);
  }
  byId("ghost-line").setAttribute("transform", `translate(${tx} ${ty})`);
  byId("bg-layer").style.backgroundPosition = `${tx}px ${ty}px`;
};

// Centre the camera on the bounding box of every concrete piece on
// the current map. Pure with respect to the supplied currentMap; the
// only side effect is mutating `viewport` and replaying applyViewport.
export const recenter = (currentMap: {
  readonly boxes?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly texts?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly lines?: ReadonlyArray<{
    readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number;
  }>;
}): void => {
  const points: Array<readonly [number, number]> = [];
  for (const b of currentMap.boxes ?? []) points.push([b.x, b.y]);
  for (const t of currentMap.texts ?? []) points.push([t.x, t.y]);
  for (const l of currentMap.lines ?? []) {
    points.push([l.x1, l.y1]);
    points.push([l.x2, l.y2]);
  }
  if (points.length === 0) {
    viewport.x = 0;
    viewport.y = 0;
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    viewport.x = window.innerWidth / 2 - cx;
    viewport.y = window.innerHeight / 2 - cy;
  }
  applyViewport();
};

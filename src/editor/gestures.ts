// Pure gesture-classification helpers extracted from touch.ts so they
// can be tested in isolation. The imperative touch handler still owns
// state mutation, DOM lookup, and event flow — these helpers just
// answer the underlying yes/no questions.
//
// Kept deliberately tiny and dependency-free so they compose into any
// pointer-event handler we add later (mouse double-click, pen tap,
// pointerEvents migration, etc.) without dragging touch-specific
// concerns along.

export interface TapRecord {
  readonly id: string;
  readonly time: number;
}

export type TapKind = "single" | "double";

// Classify a fresh tap given the previous one. A "double" requires
// the same id within `doubleTapMs`; anything else is a "single" and
// becomes the new lastTap baseline. Pure — caller owns the lastTap
// pointer.
export const classifyTap = (
  lastTap: TapRecord | null,
  current: TapRecord,
  doubleTapMs: number,
): { kind: TapKind; nextLastTap: TapRecord | null } => {
  if (
    lastTap !== null &&
    lastTap.id === current.id &&
    current.time - lastTap.time <= doubleTapMs
  ) {
    return { kind: "double", nextLastTap: null };
  }
  return { kind: "single", nextLastTap: current };
};

// Has the touch travelled far enough from its starting point to
// count as a drag rather than a tap / long-press? `tolerance` is in
// the same unit as the inputs (CSS pixels for clientX / clientY).
export const movedBeyond = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tolerance: number,
): boolean => Math.hypot(endX - startX, endY - startY) > tolerance;

// True iff a `visualViewport.resize` event was caused by the soft
// keyboard rather than the URL-bar / toolbar collapse. iOS Safari
// fires the same event for both, so we discriminate by size: the
// keyboard claims hundreds of pixels, the URL bar only ~50–90.
//
// `threshold` defaults to 150px which sits comfortably between the
// two regimes on every iOS device through 2026.
export const isKeyboardResize = (
  layoutHeight: number,
  visualHeight: number,
  threshold = 150,
): boolean => layoutHeight - visualHeight > threshold;

// Platform detection: macOS reserves Ctrl+click for the secondary
// click gesture, so the "primary" modifier for navigation-style
// shortcuts is Cmd on Mac and Ctrl everywhere else. Keyboard shortcuts
// (Cmd+Z, Cmd+A, …) accept either modifier and don't need this helper;
// only the mouse path does.

export const IS_MAC: boolean =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgent || "",
  );

export const primaryMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  IS_MAC ? e.metaKey : e.ctrlKey;

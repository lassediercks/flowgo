// Help overlay: visible/hidden state plus the wiring that opens it
// from the toolbar button and closes it on backdrop click. The
// keyboard handler in main.ts asks `isHelpOpen()` to decide whether
// Escape should close the overlay vs. clear the selection.

const overlay = (): HTMLElement => {
  const el = document.getElementById("helpOverlay");
  if (!el) throw new Error("helpOverlay missing from DOM");
  return el;
};

export const setHelpOpen = (open: boolean): void => {
  overlay().classList.toggle("hidden", !open);
};

export const isHelpOpen = (): boolean =>
  !overlay().classList.contains("hidden");

export const attachHelpListeners = (): void => {
  const btn = document.getElementById("helpBtn");
  const close = document.getElementById("helpClose");
  btn?.addEventListener("click", () => setHelpOpen(true));
  close?.addEventListener("click", () => setHelpOpen(false));
  overlay().addEventListener("mousedown", (e) => {
    if (e.target === overlay()) setHelpOpen(false);
  });
};

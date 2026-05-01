// Inline label editing for boxes and text items. Owns the `editing`
// flag (it's the gate every keyboard handler in main.ts checks before
// firing a shortcut), and handles the contenteditable lifecycle
// including the cancel-deletes rollback for boxes spawned with
// `Enter` editing on creation.
//
// Two flavours: text items just edit their textContent; boxes wrap
// their label in a `.box-label` span and read back via el.textContent
// to capture pasted content the browser sometimes lands as siblings
// of that span.

import { MAX_LABEL_LEN } from "../graph/label.ts";

interface BoxLike {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface TextLike {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface EditBindings {
  readonly canvas: HTMLElement;
  readonly getCurrentMap: () => {
    boxes: BoxLike[];
    edges: { from: string; to: string }[];
  };
  readonly setCurrentMap: (m: ReturnType<EditBindings["getCurrentMap"]>) => void;
  readonly getCurrentPath: () => string;
  readonly getGraph: () => { maps: { path: string }[] };
  readonly setGraph: (g: { maps: { path: string }[] }) => void;
  readonly ensureMap: (path: string) => ReturnType<EditBindings["getCurrentMap"]>;
  readonly selected: Set<string>;
  readonly scheduleSave: () => void;
  readonly renderAll: () => void;
  readonly setStatus: (s: string) => void;
}

let bindings: EditBindings | null = null;
const must = (): EditBindings => {
  if (!bindings) throw new Error("edit: wireEdit() not called");
  return bindings;
};

export const wireEdit = (b: EditBindings): void => {
  bindings = b;
};

let editing: HTMLElement | null = null;
export const isEditing = (): boolean => editing !== null;

const normalize = (raw: string): string =>
  raw.replace(/\s+/g, " ").trim();

export const startTextEdit = (el: HTMLElement, t: TextLike): void => {
  if (editing) return;
  editing = el;
  el.contentEditable = "true";
  el.textContent = t.label;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const finish = (commit: boolean): void => {
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    el.contentEditable = "false";
    editing = null;
    const newLabel = normalize(el.textContent ?? "");
    if (commit && newLabel && newLabel !== t.label) {
      t.label = newLabel;
      must().scheduleSave();
    }
    el.textContent = t.label;
  };
  const onBlur = (): void => finish(true);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      el.blur();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
    }
    ev.stopPropagation();
  };
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
};

export interface BoxEditOptions {
  readonly cancelDeletes?: boolean;
}

export const startEdit = (
  el: HTMLElement,
  b: BoxLike,
  opts?: BoxEditOptions,
): void => {
  if (editing) return;
  const cancelDeletes = opts?.cancelDeletes ?? false;
  const labelEl = el.querySelector<HTMLElement>(".box-label");
  if (!labelEl) {
    // Defensive: if the label span is missing for any reason, rebuild
    // the box from state and retry. Beats wedging `editing` to a
    // stale element and locking out every keyboard shortcut.
    must().renderAll();
    const fresh = must().canvas.querySelector<HTMLElement>(
      `.box[data-id="${b.id}"]`,
    );
    if (fresh) startEdit(fresh, b, opts);
    return;
  }
  editing = el;
  el.contentEditable = "true";
  labelEl.textContent = b.label;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(labelEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const finish = (commit: boolean): void => {
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    el.contentEditable = "false";
    editing = null;
    // Read from el, not labelEl: contenteditable can land pasted
    // text in sibling text nodes / divs directly under el (outside
    // the span). The SVG polygon and handle divs contribute no text
    // content, so el.textContent is just the label across whichever
    // children the browser used.
    let newLabel = normalize(el.textContent ?? "");
    if (newLabel.length > MAX_LABEL_LEN) {
      newLabel = newLabel.slice(0, MAX_LABEL_LEN);
      must().setStatus("label truncated to " + MAX_LABEL_LEN + " characters");
    }
    if (!commit && cancelDeletes) {
      const w = must();
      // Roll back: drop the just-spawned box and any of its edges.
      const map = w.getCurrentMap();
      map.boxes = map.boxes.filter((x) => x.id !== b.id);
      map.edges = map.edges.filter(
        (e) => e.from !== b.id && e.to !== b.id,
      );
      const cur = w.getCurrentPath();
      const removedPath = cur === "/" ? "/" + b.id : cur + "/" + b.id;
      const g = w.getGraph();
      g.maps = g.maps.filter(
        (m) => m.path !== removedPath && !m.path.startsWith(removedPath + "/"),
      );
      w.setGraph(g);
      w.setCurrentMap(w.ensureMap(cur));
      w.selected.delete(b.id);
      w.scheduleSave();
      w.renderAll();
      w.setStatus("cancelled");
      return;
    }
    if (commit && newLabel && newLabel !== b.label) {
      b.label = newLabel;
      must().scheduleSave();
    }
    // Rebuild the affected box from state. Trying to surgically
    // pluck out only the stray nodes the contenteditable inserted
    // is brittle (the browser sometimes wraps the label span in a
    // div, and a direct-child sweep then deletes the wrapper *and*
    // the span). A full renderAll is heavier but guarantees the
    // DOM matches state.
    must().renderAll();
  };
  const onBlur = (): void => finish(true);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation();
  };
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
};

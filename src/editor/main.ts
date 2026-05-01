// @ts-nocheck — strict-typing this 1800-line imperative file in a
// single pass would be a multi-hundred-error blocker. The disciplined
// path is to keep peeling pure functions out into src/graph/* (where
// they're already strict-typed and tested) and let this file shrink.
//
// Pure helpers live in their own typed modules (src/graph/*) and are
// covered by Vitest. This file is the imperative editor glue that
// wires them to the DOM; future phases will keep extracting more.
import {
  MAX_LABEL_LEN,
  addOrReplaceEdge as addOrReplaceEdgePure,
  boxSides,
  collectIds,
  hasSubmapContent,
  nextUid,
  polygonPointsForSides,
  serializeGraph as serializeGraphPure,
  strokePathD,
} from "../index.ts";
import { attachHelpListeners, isHelpOpen, setHelpOpen } from "./help.ts";
import {
  applyViewport,
  recenter as recenterPure,
  toDataX,
  toDataY,
  viewport,
} from "./viewport.ts";
import {
  extendStroke,
  finishStroke,
  isBrushMode,
  isPainting,
  setBrushMode,
  startStroke,
  wireBrush,
} from "./brush.ts";
import {
  copySelection,
  cutSelection,
  pasteSelection,
  wireClipboard,
} from "./clipboard.ts";
import {
  attachNavigationListeners,
  enterSubmap,
  ensureMap,
  goUp,
  navigateTo,
  readPathFromURL,
  renderPath,
  wireNavigation,
} from "./navigation.ts";
import {
  SNAPSHOT_ID,
  SNAPSHOT_MODE,
  downloadFlowgo,
  load,
  redo,
  reshare,
  scheduleSave,
  undo,
  wirePersistence,
} from "./persistence.ts";
import {
  GRID,
  makeBoxMover,
  makeLineEndpointMover,
  makeLineMover,
  makeTextMover,
  snap,
} from "./movers.ts";
import {
  cloneSelection as cloneSelectionPure,
  wireClone,
} from "./clone.ts";
import {
  endpointAnchor,
  handleAnchor,
  nearestHandle,
  polygonAnchor,
} from "./anchors.ts";

let graph = { maps: [] };
let currentPath = "/";
let state = { boxes: [], edges: [] }; // alias for the current map
let selected = new Set();
let band = null; // rubber-band selection state
let lastCursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let pan = null;

// Keep the no-arg recenter() shape that the rest of main.ts uses.
const recenter = () => recenterPure(state);
// savedSnapshot / undoStack / redoStack / saveTimer / UNDO_LIMIT all
// live in ./persistence.ts now.
let selectedEdge = null; // reference to an entry in state.edges
let drag = null;       // box drag
let link = null;       // link drag from a handle
let editing = null;
let dropTargetId = null;
let nearTargetId = null; // box close enough to the cursor during a link drag

// On macOS the platform reserves Ctrl+click for the secondary-click gesture
// (= right-click), so we use Cmd as the "primary" modifier there. On every
// other OS, Ctrl is the standard primary modifier. The helper picks the
// correct event property without us having to remember in each callsite.
const IS_MAC = (typeof navigator !== "undefined") &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
function primaryMod(e) { return IS_MAC ? e.metaKey : e.ctrlKey; }

const canvas = document.getElementById("canvas");
const svg = document.getElementById("edges");
const edgeLayer = document.getElementById("edge-layer");
const lineLayer = document.getElementById("line-layer");
const strokeLayer = document.getElementById("stroke-layer");
const ghostLine = document.getElementById("ghost-line");

const HANDLE_CODES = ["t","r","b","l","tl","tr","bl","br"];

function uid(prefix) {
  return nextUid(prefix || "b", collectIds(
    state.boxes,
    state.texts || [],
    state.lines || [],
    state.strokes || [],
  ));
}

function findTextById(id) { return state.texts.find(t => t.id === id); }
function findLineById(id) { return state.lines.find(l => l.id === id); }
function findItem(id) {
  const b = state.boxes.find(x => x.id === id); if (b) return { kind: "box",  ref: b };
  const t = findTextById(id);                   if (t) return { kind: "text", ref: t };
  const l = findLineById(id);                   if (l) return { kind: "line", ref: l };
  return null;
}

function setStatus(_s) { /* hint area removed — keep callers harmless */ }

// Path navigation + persistence/history live in their own modules.
// Wire the host's live state in once at startup.
wireNavigation({
  getGraph: () => graph,
  getCurrentPath: () => currentPath,
  setCurrentPath: (p) => { currentPath = p; },
  setCurrentMap: (m) => { state = m; },
  clearSelected: () => selected.clear(),
  clearSelectedEdge: () => { selectedEdge = null; },
  renderAll: () => renderAll(),
});
attachNavigationListeners();

const setCurrentPath = navigateTo;
const serializeGraph = serializeGraphPure;

wirePersistence({
  getGraph: () => graph,
  setGraph: (g) => { graph = g; },
  serializeGraph: (g) => serializeGraph(g),
  setCurrentPath: (p, opts) => navigateTo(p, opts),
  getCurrentPath: () => currentPath,
  readPathFromURL,
  setStatus: (s) => setStatus(s),
  clearSelected: () => selected.clear(),
  clearSelectedEdge: () => { selectedEdge = null; },
});

// Thin closure over the live graph + current path so the call sites
// keep their `boxHasSubmapContent(boxId)` shape.
const boxHasSubmapContent = (boxId) =>
  hasSubmapContent(graph, currentPath, boxId);

function renderAll() {
  canvas.innerHTML = "";
  for (const b of state.boxes) {
    const el = document.createElement("div");
    const sides = boxSides(b);
    const palette = (b.palette >= 2 && b.palette <= 9) ? b.palette : 1;
    const font = (b.font >= 2 && b.font <= 9) ? b.font : 1;
    el.className = "box"
      + (sides !== 4 ? " shaped sides-" + sides : "")
      + (boxHasSubmapContent(b.id) ? " has-submap" : "")
      + (palette !== 1 ? " palette-" + palette : "")
      + (font !== 1 ? " font-" + font : "");
    el.dataset.id = b.id;
    el.style.left = b.x + "px";
    el.style.top = b.y + "px";
    if (sides !== 4) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "shape-svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("class", "shape-poly");
      poly.setAttribute("points", polygonPointsForSides(sides));
      poly.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(poly);
      el.appendChild(svg);
    }
    const label = document.createElement("span");
    label.className = "box-label";
    label.textContent = b.label;
    el.appendChild(label);
    for (const code of HANDLE_CODES) {
      const h = document.createElement("div");
      h.className = "handle h-" + code;
      h.dataset.handle = code;
      el.appendChild(h);
    }
    canvas.appendChild(el);
    attachBoxHandlers(el, b);
  }
  for (const t of state.texts) {
    const el = document.createElement("div");
    const tPalette = (t.palette >= 2 && t.palette <= 9) ? t.palette : 1;
    const tFont = (t.font >= 2 && t.font <= 9) ? t.font : 1;
    el.className = "text-item"
      + (tPalette !== 1 ? " palette-" + tPalette : "")
      + (tFont !== 1 ? " font-" + tFont : "");
    el.dataset.id = t.id;
    el.style.left = t.x + "px";
    el.style.top = t.y + "px";
    el.textContent = t.label;
    canvas.appendChild(el);
    attachTextHandlers(el, t);
  }
  applyClasses();
  renderLines();
  renderStrokes();
  renderEdges();
}

function strokePointsAttr(points) {
  return points.map(p => p[0] + "," + p[1]).join(" ");
}

function renderStrokes() {
  strokeLayer.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  for (const s of (state.strokes || [])) {
    if (!s.points || s.points.length < 2) continue;
    const d = strokePathD(s.points);
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "stroke-group" + (selected.has(s.id) ? " selected" : ""));
    g.dataset.id = s.id;

    const hit = document.createElementNS(ns, "path");
    hit.setAttribute("class", "stroke-hit");
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "12");
    g.appendChild(hit);

    const line = document.createElementNS(ns, "path");
    line.setAttribute("class", "stroke-line");
    line.setAttribute("d", d);
    line.setAttribute("fill", "none");
    g.appendChild(line);

    g.addEventListener("mousedown", (ev) => {
      if (isBrushMode()) return;
      ev.stopPropagation();
      if (!ev.shiftKey) selected.clear();
      selected.add(s.id);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
      renderStrokes();
    });

    strokeLayer.appendChild(g);
  }
}

function renderLines() {
  lineLayer.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  for (const l of state.lines) {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "line-group" + (selected.has(l.id) ? " selected" : ""));
    g.dataset.id = l.id;

    const hit = document.createElementNS(ns, "line");
    hit.setAttribute("class", "line-hit");
    hit.setAttribute("x1", l.x1); hit.setAttribute("y1", l.y1);
    hit.setAttribute("x2", l.x2); hit.setAttribute("y2", l.y2);
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "12");
    g.appendChild(hit);

    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "line-line");
    line.setAttribute("x1", l.x1); line.setAttribute("y1", l.y1);
    line.setAttribute("x2", l.x2); line.setAttribute("y2", l.y2);
    g.appendChild(line);

    const h1 = document.createElementNS(ns, "circle");
    h1.setAttribute("class", "line-handle");
    h1.setAttribute("cx", l.x1); h1.setAttribute("cy", l.y1);
    h1.setAttribute("r", 6);
    h1.dataset.endpoint = "1";
    g.appendChild(h1);

    const h2 = document.createElementNS(ns, "circle");
    h2.setAttribute("class", "line-handle");
    h2.setAttribute("cx", l.x2); h2.setAttribute("cy", l.y2);
    h2.setAttribute("r", 6);
    h2.dataset.endpoint = "2";
    g.appendChild(h2);

    attachLineHandlers(g, line, hit, h1, h2, l);
    lineLayer.appendChild(g);
  }
}

function applyClasses() {
  for (const el of canvas.querySelectorAll(".box")) {
    el.classList.toggle("selected", selected.has(el.dataset.id));
    el.classList.toggle("drop-target", el.dataset.id === dropTargetId);
    el.classList.toggle("proximity-target", el.dataset.id === nearTargetId);
  }
  for (const el of canvas.querySelectorAll(".text-item")) {
    el.classList.toggle("selected", selected.has(el.dataset.id));
  }
  for (const el of lineLayer.querySelectorAll(".line-group")) {
    el.classList.toggle("selected", selected.has(el.dataset.id));
  }
  for (const el of strokeLayer.querySelectorAll(".stroke-group")) {
    el.classList.toggle("selected", selected.has(el.dataset.id));
  }
}

const PROXIMITY_PX = 60;
function updateProximity(cx, cy) {
  let best = null, bestD = Infinity;
  for (const b of state.boxes) {
    if (link && b.id === link.fromId) continue;
    const el = canvas.querySelector(`.box[data-id="${b.id}"]`);
    if (!el) continue;
    const x1 = b.x, y1 = b.y;
    const x2 = b.x + el.offsetWidth, y2 = b.y + el.offsetHeight;
    const ddx = Math.max(x1 - cx, 0, cx - x2);
    const ddy = Math.max(y1 - cy, 0, cy - y2);
    const d = Math.hypot(ddx, ddy);
    if (d < bestD && d <= PROXIMITY_PX) { bestD = d; best = b.id; }
  }
  if (best !== nearTargetId) {
    nearTargetId = best;
    applyClasses();
  }
}

function clearProximity() {
  if (nearTargetId !== null) {
    nearTargetId = null;
    applyClasses();
  }
}

function renderEdges() {
  edgeLayer.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  for (const e of state.edges) {
    const a = state.boxes.find(b => b.id === e.from);
    const b = state.boxes.find(b => b.id === e.to);
    if (!a || !b) continue;
    const ea = canvas.querySelector(`.box[data-id="${a.id}"]`);
    const eb = canvas.querySelector(`.box[data-id="${b.id}"]`);
    if (!ea || !eb) continue;
    const acx = a.x + ea.offsetWidth / 2, acy = a.y + ea.offsetHeight / 2;
    const bcx = b.x + eb.offsetWidth / 2, bcy = b.y + eb.offsetHeight / 2;
    const [ax, ay] = endpointAnchor(a, ea, e.fromHandle, bcx, bcy);
    const [bx, by] = endpointAnchor(b, eb, e.toHandle, acx, acy);

    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "edge-group" + (e === selectedEdge ? " selected" : ""));

    const hit = document.createElementNS(ns, "line");
    hit.setAttribute("class", "edge-hit");
    hit.setAttribute("x1", ax); hit.setAttribute("y1", ay);
    hit.setAttribute("x2", bx); hit.setAttribute("y2", by);
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "12");
    g.appendChild(hit);

    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "edge-line");
    line.setAttribute("x1", ax); line.setAttribute("y1", ay);
    line.setAttribute("x2", bx); line.setAttribute("y2", by);
    g.appendChild(line);

    g.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      selectedEdge = e;
      selected.clear();
      applyClasses();
      renderEdges();
      setStatus("edge selected — press Delete to remove");
    });

    edgeLayer.appendChild(g);
  }
}

// Handle dots still render with a CSS offset (-20px) so they're easy to grab,
// but edge endpoints anchor to the box's actual border so the line visually
// Edge-anchor adapters live in ./anchors.ts.

// Mutate the live state.edges in-place so existing call sites keep
// working; the actual replacement logic is the pure helper.
function addOrReplaceEdge(newEdge) {
  state.edges = addOrReplaceEdgePure(state.edges, newEdge);
}

wireClone({
  currentMap: () => state,
  selected,
  findTextById,
  findLineById,
  mintId: uid,
});

// Thin shell so existing call sites keep their `cloneSelection()` shape;
// the pure clone returns the id map but leaves rendering to the caller.
function cloneSelection() {
  const idMap = cloneSelectionPure();
  renderAll();
  applyClasses();
  scheduleSave();
  return idMap;
}

// Drag movers (box / text / line / line-endpoint) and the GRID/snap
// shift-snap helpers live in ./movers.ts.

function collectMovers() {
  const movers = [];
  for (const id of selected) {
    const b = state.boxes.find(x => x.id === id);
    if (b) {
      const me = canvas.querySelector(`.box[data-id="${id}"]`);
      if (me) movers.push(makeBoxMover(b, me));
      continue;
    }
    const t = findTextById(id);
    if (t) {
      const me = canvas.querySelector(`.text-item[data-id="${id}"]`);
      if (me) movers.push(makeTextMover(t, me));
      continue;
    }
    const l = findLineById(id);
    if (l) {
      const g = lineLayer.querySelector(`.line-group[data-id="${id}"]`);
      if (g) {
        const lineEl = g.querySelector(".line-line");
        const hitEl = g.querySelector(".line-hit");
        const h1 = g.querySelector('.line-handle[data-endpoint="1"]');
        const h2 = g.querySelector('.line-handle[data-endpoint="2"]');
        movers.push(makeLineMover(l, g, lineEl, hitEl, h1, h2));
      }
    }
  }
  return movers;
}

function attachTextHandlers(el, t) {
  el.addEventListener("mousedown", (e) => {
    if (el.isContentEditable) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(t.id)) {
      if (!e.shiftKey) selected.clear();
      selected.add(t.id);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
    }
    let primaryId = t.id;
    if (e.altKey) {
      const idMap = cloneSelection();
      if (idMap.has(t.id)) primaryId = idMap.get(t.id);
    }
    drag = {
      movers: collectMovers(),
      primaryId,
      downX: e.clientX, downY: e.clientY,
      active: false,
    };
  });
  el.addEventListener("dblclick", (e) => {
    if (el.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    selected.clear();
    selected.add(t.id);
    applyClasses();
    startTextEdit(el, t);
  });
}

function attachLineHandlers(g, lineEl, hitEl, h1, h2, l) {
  hitEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(l.id)) {
      if (!e.shiftKey) selected.clear();
      selected.add(l.id);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
    }
    let primaryId = l.id;
    if (e.altKey) {
      const idMap = cloneSelection();
      if (idMap.has(l.id)) primaryId = idMap.get(l.id);
    }
    drag = {
      movers: collectMovers(),
      primaryId,
      downX: e.clientX, downY: e.clientY,
      active: false,
    };
  });
  for (const [hEl, endpoint] of [[h1, 1], [h2, 2]]) {
    hEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // endpoint drag — single endpoint, ignores multi-selection
      selected.clear();
      selected.add(l.id);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
      drag = {
        movers: [makeLineEndpointMover(l, endpoint, { g, line: lineEl, hit: hitEl, h1, h2 })],
        primaryId: l.id,
        downX: e.clientX, downY: e.clientY,
        active: false,
      };
    });
  }
}

function startTextEdit(el, t) {
  if (editing) return;
  editing = el;
  el.contentEditable = "true";
  el.textContent = t.label;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const finish = (commit) => {
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    el.contentEditable = "false";
    editing = null;
    const newLabel = el.textContent.replace(/\s+/g, " ").trim();
    if (commit && newLabel && newLabel !== t.label) {
      t.label = newLabel;
      scheduleSave();
    }
    el.textContent = t.label;
  };
  const onBlur = () => finish(true);
  const onKey = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
    else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  };
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
}

function attachBoxHandlers(el, b) {
  el.addEventListener("mousedown", (e) => {
    if (el.isContentEditable) return;
    if (e.button === 1 || (e.button === 0 && primaryMod(e))) {
      e.preventDefault();
      e.stopPropagation();
      enterSubmap(b.id);
      return;
    }
    if (e.button !== 0) return;

    // handle click? start link-drag (new edge, or re-route an existing edge).
    if (e.target.classList.contains("handle")) {
      e.preventDefault();
      e.stopPropagation();
      const code = e.target.dataset.handle;

      // Is there an existing edge anchored to this exact box+handle? If so, pick it up.
      let pickedEdge = null;
      let anchoredId = null;
      let anchoredHandle = "";
      for (let i = state.edges.length - 1; i >= 0; i--) {
        const ed = state.edges[i];
        if (ed.from === b.id && ed.fromHandle === code) {
          pickedEdge = ed; anchoredId = ed.to;   anchoredHandle = ed.toHandle   || ""; break;
        }
        if (ed.to === b.id && ed.toHandle === code) {
          pickedEdge = ed; anchoredId = ed.from; anchoredHandle = ed.fromHandle || ""; break;
        }
      }

      if (pickedEdge) {
        const idx = state.edges.indexOf(pickedEdge);
        if (idx >= 0) state.edges.splice(idx, 1);
        const anchoredBox = state.boxes.find(x => x.id === anchoredId);
        const anchoredEl = canvas.querySelector(`.box[data-id="${anchoredId}"]`);
        if (!anchoredBox || !anchoredEl) {
          // Anchored end vanished; bail out (and put the edge back).
          state.edges.push(pickedEdge);
          renderEdges();
          return;
        }
        const fallbackTowardX = b.x + el.offsetWidth / 2;
        const fallbackTowardY = b.y + el.offsetHeight / 2;
        const code2 = anchoredHandle || nearestHandle(anchoredBox, anchoredEl, fallbackTowardX, fallbackTowardY);
        const [hx, hy] = handleAnchor(anchoredEl, anchoredBox, code2);
        link = {
          fromId: anchoredId,
          fromHandle: code2,
          startX: hx, startY: hy,
          handleEl: e.target,
          rerouting: true,
        };
        e.target.classList.add("active");
        ghostLine.setAttribute("x1", hx);
        ghostLine.setAttribute("y1", hy);
        ghostLine.setAttribute("x2", toDataX(e.clientX));
        ghostLine.setAttribute("y2", toDataY(e.clientY));
        ghostLine.style.display = "";
        renderEdges();
        setStatus("re-routing edge — drop on a box, or in empty space");
        return;
      }

      // No existing edge: start a new connection from this handle.
      const [hx, hy] = handleAnchor(el, b, code);
      link = {
        fromId: b.id,
        fromHandle: code,
        startX: hx, startY: hy,
        handleEl: e.target,
      };
      e.target.classList.add("active");
      ghostLine.setAttribute("x1", hx);
      ghostLine.setAttribute("y1", hy);
      ghostLine.setAttribute("x2", toDataX(e.clientX));
      ghostLine.setAttribute("y2", toDataY(e.clientY));
      ghostLine.style.display = "";
      setStatus("drop on a box to connect, or release to cancel");
      return;
    }

    // body drag (single or multi-select)
    e.preventDefault();
    e.stopPropagation();
    // If this box isn't already in the selection, replace the selection with just it.
    if (!selected.has(b.id)) {
      if (!e.shiftKey) selected.clear();
      selected.add(b.id);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
    }
    let primaryId = b.id;

    // alt/option+drag: duplicate the selection and drag the clones instead.
    if (e.altKey) {
      const idMap = cloneSelection();
      if (idMap.has(b.id)) primaryId = idMap.get(b.id);
    }

    drag = {
      movers: collectMovers(),
      primaryId,
      downX: e.clientX, downY: e.clientY,
      active: false,
    };
  });

  el.addEventListener("dblclick", (e) => {
    if (el.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    selected.clear();
    selected.add(b.id);
    if (selectedEdge) { selectedEdge = null; renderEdges(); }
    applyClasses();
    startEdit(el, b);
  });
}

document.addEventListener("mousemove", (e) => {
  lastCursor.x = e.clientX;
  lastCursor.y = e.clientY;
  if (isPainting()) { extendStroke(e); return; }
  if (pan) {
    viewport.x = pan.startVX + (e.clientX - pan.downX);
    viewport.y = pan.startVY + (e.clientY - pan.downY);
    applyViewport();
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.downX;
    const dy = e.clientY - drag.downY;
    if (!drag.active && Math.hypot(dx, dy) > 4) {
      drag.active = true;
      for (const m of drag.movers) if (m.el && m.el.classList) m.el.classList.add("dragging");
    }
    if (drag.active) {
      for (const m of drag.movers) m.apply(dx, dy, e);
      renderEdges();
    }
    return;
  }
  if (band) {
    const x = Math.min(band.startX, e.clientX);
    const y = Math.min(band.startY, e.clientY);
    const w = Math.abs(e.clientX - band.startX);
    const h = Math.abs(e.clientY - band.startY);
    band.el.style.left = x + "px";
    band.el.style.top = y + "px";
    band.el.style.width = w + "px";
    band.el.style.height = h + "px";
    return;
  }
  if (link) {
    ghostLine.setAttribute("x2", toDataX(e.clientX));
    ghostLine.setAttribute("y2", toDataY(e.clientY));
    const target = findBoxAt(e.clientX, e.clientY);
    const id = target && target.dataset.id !== link.fromId ? target.dataset.id : null;
    if (id !== dropTargetId) {
      dropTargetId = id;
      applyClasses();
    }
    updateProximity(toDataX(e.clientX), toDataY(e.clientY));
    return;
  }
  // Idle hover: still reveal handles on the nearest box if the cursor is
  // within PROXIMITY_PX. Skipped while pan/drag/band/link is active.
  updateProximity(toDataX(e.clientX), toDataY(e.clientY));
});

document.addEventListener("mouseup", (e) => {
  if (isPainting()) { finishStroke(); return; }
  if (pan) {
    pan = null;
    document.body.classList.remove("panning");
    return;
  }
  if (drag) {
    const wasActive = drag.active;
    for (const m of drag.movers) if (m.el && m.el.classList) m.el.classList.remove("dragging");
    const primaryId = drag.primaryId;
    drag = null;
    if (wasActive) {
      scheduleSave();
    } else {
      // single-click without movement: collapse selection to just this item.
      selected.clear();
      if (primaryId) selected.add(primaryId);
      if (selectedEdge) { selectedEdge = null; renderEdges(); }
      applyClasses();
    }
    return;
  }
  if (band) {
    const cX1 = Math.min(band.startX, e.clientX);
    const cY1 = Math.min(band.startY, e.clientY);
    const cX2 = Math.max(band.startX, e.clientX);
    const cY2 = Math.max(band.startY, e.clientY);
    if (cX2 - cX1 > 2 || cY2 - cY1 > 2) {
      // Convert band rect from client to data coords for comparison with stored positions.
      const x1 = toDataX(cX1), y1 = toDataY(cY1);
      const x2 = toDataX(cX2), y2 = toDataY(cY2);
      for (const b of state.boxes) {
        const el = canvas.querySelector(`.box[data-id="${b.id}"]`);
        if (!el) continue;
        const bx2 = b.x + el.offsetWidth;
        const by2 = b.y + el.offsetHeight;
        if (b.x < x2 && bx2 > x1 && b.y < y2 && by2 > y1) {
          selected.add(b.id);
        }
      }
      for (const t of state.texts) {
        const el = canvas.querySelector(`.text-item[data-id="${t.id}"]`);
        if (!el) continue;
        const tx2 = t.x + el.offsetWidth;
        const ty2 = t.y + el.offsetHeight;
        if (t.x < x2 && tx2 > x1 && t.y < y2 && ty2 > y1) {
          selected.add(t.id);
        }
      }
      for (const l of state.lines) {
        const lx1 = Math.min(l.x1, l.x2);
        const ly1 = Math.min(l.y1, l.y2);
        const lx2 = Math.max(l.x1, l.x2);
        const ly2 = Math.max(l.y1, l.y2);
        if (lx1 < x2 && lx2 > x1 && ly1 < y2 && ly2 > y1) {
          selected.add(l.id);
        }
      }
      applyClasses();
      if (selected.size > 0) setStatus(selected.size + " selected");
    }
    band.el.remove();
    band = null;
    return;
  }
  if (link) {
    link.handleEl.classList.remove("active");
    ghostLine.style.display = "none";
    const target = findBoxAt(e.clientX, e.clientY);
    if (target && target.dataset.id !== link.fromId) {
      const toId = target.dataset.id;
      const targetBox = state.boxes.find(b => b.id === toId);
      // If the cursor is over one of this target's handles, use that handle code.
      // Otherwise pick the handle closest to the source anchor.
      let toCode = null;
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (const stackEl of stack) {
        if (stackEl.classList && stackEl.classList.contains("handle") && stackEl.parentElement === target) {
          toCode = stackEl.dataset.handle;
          break;
        }
      }
      if (!toCode) {
        toCode = nearestHandle(targetBox, target, link.startX, link.startY);
      }
      addOrReplaceEdge({ from: link.fromId, fromHandle: link.fromHandle, to: toId, toHandle: toCode });
      scheduleSave();
      renderEdges();
    } else {
      // Dropped in empty space: spawn a new box at the cursor and connect to it.
      const newId = uid();
      const dropX = toDataX(e.clientX), dropY = toDataY(e.clientY);
      const newBox = { id: newId, label: "new", x: dropX, y: dropY };
      state.boxes.push(newBox);
      renderAll();
      const newEl = canvas.querySelector(`.box[data-id="${newId}"]`);
      if (newEl) {
        newBox.x = dropX - newEl.offsetWidth / 2;
        newBox.y = dropY - newEl.offsetHeight / 2;
        newEl.style.left = newBox.x + "px";
        newEl.style.top = newBox.y + "px";
        const toCode = nearestHandle(newBox, newEl, link.startX, link.startY);
        addOrReplaceEdge({ from: link.fromId, fromHandle: link.fromHandle, to: newId, toHandle: toCode });
        renderEdges();
        selected.clear();
        selected.add(newId);
        applyClasses();
        startEdit(newEl, newBox, { cancelDeletes: true });
      }
      scheduleSave();
    }
    link = null;
    if (dropTargetId) { dropTargetId = null; applyClasses(); }
    clearProximity();
  }
});

function findBoxAt(x, y) {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!el || el === ghostLine) continue;
    const box = el.closest && el.closest(".box");
    if (box) return box;
  }
  return null;
}

function startEdit(el, b, opts) {
  if (editing) return;
  const cancelDeletes = opts && opts.cancelDeletes;
  const labelEl = el.querySelector(".box-label");
  if (!labelEl) {
    // Defensive: if the label span is missing for any reason, rebuild
    // the box from state and retry. Beats wedging `editing` to a stale
    // element and locking out every keyboard shortcut.
    renderAll();
    const fresh = canvas.querySelector(`.box[data-id="${b.id}"]`);
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
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (commit) => {
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    el.contentEditable = "false";
    editing = null;
    // Read from el, not labelEl: contenteditable can land pasted text in
    // sibling text nodes / divs directly under el (outside the span). The
    // SVG polygon and handle divs contribute no text content, so el.textContent
    // is just the label across whichever children the browser used.
    let newLabel = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (newLabel.length > MAX_LABEL_LEN) {
      newLabel = newLabel.slice(0, MAX_LABEL_LEN);
      setStatus("label truncated to " + MAX_LABEL_LEN + " characters");
    }
    if (!commit && cancelDeletes) {
      // Roll back: drop the just-spawned box and any of its edges.
      state.boxes = state.boxes.filter(x => x.id !== b.id);
      state.edges = state.edges.filter(e => e.from !== b.id && e.to !== b.id);
      const removedPath = currentPath === "/" ? "/" + b.id : currentPath + "/" + b.id;
      graph.maps = graph.maps.filter(m =>
        m.path !== removedPath && !m.path.startsWith(removedPath + "/"));
      state = ensureMap(currentPath);
      selected.delete(b.id);
      scheduleSave();
      renderAll();
      setStatus("cancelled");
      return;
    }
    if (commit && newLabel && newLabel !== b.label) {
      b.label = newLabel;
      scheduleSave();
    }
    // Rebuild the affected box from state. Trying to surgically pluck
    // out only the stray nodes the contenteditable inserted is brittle
    // (the browser sometimes wraps the label span in a div, and a
    // direct-child sweep then deletes the wrapper *and* the span). A
    // full renderAll is heavier but guarantees the DOM matches state.
    renderAll();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    e.stopPropagation();
  };
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
}

function createBoxAt(x, y, centerOn) {
  const id = uid();
  const b = { id, label: "new", x, y };
  state.boxes.push(b);
  renderAll();
  const el = canvas.querySelector(`.box[data-id="${id}"]`);
  if (el && centerOn) {
    b.x = centerOn.x - el.offsetWidth / 2;
    b.y = centerOn.y - el.offsetHeight / 2;
    el.style.left = b.x + "px";
    el.style.top = b.y + "px";
  }
  scheduleSave();
  if (el) {
    selected.clear();
    selected.add(id);
    if (selectedEdge) { selectedEdge = null; renderEdges(); }
    applyClasses();
    startEdit(el, b);
  }
}

function createTextAt(cx, cy) {
  const id = uid("t");
  const t = { id, label: "text", x: cx, y: cy };
  state.texts.push(t);
  renderAll();
  const el = canvas.querySelector(`.text-item[data-id="${id}"]`);
  if (el) {
    t.x = cx - el.offsetWidth / 2;
    t.y = cy - el.offsetHeight / 2;
    el.style.left = t.x + "px";
    el.style.top = t.y + "px";
    selected.clear();
    selected.add(id);
    if (selectedEdge) { selectedEdge = null; renderEdges(); }
    applyClasses();
    startTextEdit(el, t);
  }
  scheduleSave();
}

function createLineAt(cx, cy) {
  const id = uid("l");
  const half = 80;
  const l = { id, x1: cx - half, y1: cy, x2: cx + half, y2: cy };
  state.lines.push(l);
  selected.clear();
  selected.add(id);
  if (selectedEdge) { selectedEdge = null; renderEdges(); }
  renderAll();
  scheduleSave();
}


document.getElementById("bg-layer").addEventListener("dblclick", (e) => {
  const dx = toDataX(e.clientX), dy = toDataY(e.clientY);
  createBoxAt(dx, dy, { x: dx, y: dy });
});

// Copy / cut / paste live in ./clipboard.ts. Wired below.
wireClipboard({
  selected,
  currentMap: () => state,
  findTextById,
  findLineById,
  mintId: uid,
  scheduleSave: () => scheduleSave(),
  renderAll: () => renderAll(),
  deleteSelection: () => deleteSelection(),
  setStatus: (s) => setStatus(s),
  clearSelectedEdge: () => { selectedEdge = null; },
});

function deleteSelection() {
  if (selected.size === 0) { setStatus("nothing selected"); return; }
  const ids = Array.from(selected);
  const boxIds = ids.filter(id => state.boxes.some(b => b.id === id));
  state.boxes = state.boxes.filter(b => !selected.has(b.id));
  state.edges = state.edges.filter(e => !selected.has(e.from) && !selected.has(e.to));
  state.texts = state.texts.filter(t => !selected.has(t.id));
  state.lines = state.lines.filter(l => !selected.has(l.id));
  state.strokes = (state.strokes || []).filter(s => !selected.has(s.id));
  // Drop each deleted box's submap and any descendants.
  for (const id of boxIds) {
    const removedPath = currentPath === "/" ? "/" + id : currentPath + "/" + id;
    graph.maps = graph.maps.filter(m =>
      m.path !== removedPath && !m.path.startsWith(removedPath + "/"));
  }
  state = ensureMap(currentPath);
  selected.clear();
  scheduleSave();
  renderAll();
}

document.getElementById("upBtn").addEventListener("click", goUp);
document.getElementById("downloadBtn").addEventListener("click", downloadFlowgo);
document.getElementById("reshareBtn").addEventListener("click", reshare);

attachHelpListeners();

// Suppress middle-click autoscroll/paste so we can use it for navigation.
window.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
window.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }, true);

// Right-click drag pans the viewport.
window.addEventListener("contextmenu", (e) => { e.preventDefault(); });
document.addEventListener("mousedown", (e) => {
  if (e.button !== 2) return;
  e.preventDefault();
  pan = {
    downX: e.clientX, downY: e.clientY,
    startVX: viewport.x, startVY: viewport.y,
  };
  document.body.classList.add("panning");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isHelpOpen()) {
    setHelpOpen(false);
    return;
  }
  if (editing) return;
  // undo / redo (Cmd on macOS, Ctrl elsewhere; Cmd+Shift+Z or Ctrl+Y for redo)
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && !e.altKey && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    redo();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    selected.clear();
    for (const b of state.boxes) selected.add(b.id);
    for (const t of (state.texts || [])) selected.add(t.id);
    for (const l of (state.lines || [])) selected.add(l.id);
    if (selectedEdge) { selectedEdge = null; renderEdges(); }
    applyClasses();
    setStatus("selected " + selected.size + " items");
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
    if (window.getSelection && String(window.getSelection())) return; // let browser copy text
    e.preventDefault();
    if (copySelection()) setStatus("copied " + selected.size + " items");
    else setStatus("nothing to copy");
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && (e.key === "x" || e.key === "X")) {
    e.preventDefault();
    cutSelection();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && (e.key === "v" || e.key === "V")) {
    e.preventDefault();
    pasteSelection();
    return;
  }
  if (!mod && !e.altKey && (e.key === "t" || e.key === "T")) {
    e.preventDefault();
    createTextAt(toDataX(lastCursor.x), toDataY(lastCursor.y));
    return;
  }
  if (!mod && !e.altKey && (e.key === "l" || e.key === "L")) {
    e.preventDefault();
    createLineAt(toDataX(lastCursor.x), toDataY(lastCursor.y));
    return;
  }
  if (!mod && !e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    setBrushMode(true);
    return;
  }
  if (!mod && !e.altKey && (e.key === "v" || e.key === "V")) {
    e.preventDefault();
    setBrushMode(false);
    return;
  }
  if (!mod && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    if (selected.size === 0) return;
    const palette = parseInt(e.key, 10);
    let changed = false;
    for (const id of selected) {
      const target = state.boxes.find(x => x.id === id) || findTextById(id);
      if (!target) continue;
      if (palette === 1) {
        if (target.palette) { delete target.palette; changed = true; }
      } else if (target.palette !== palette) {
        target.palette = palette;
        changed = true;
      }
    }
    if (changed) {
      e.preventDefault();
      scheduleSave();
      renderAll();
    }
    return;
  }
  if (!mod && !e.altKey && e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    if (selected.size === 0) return;
    const font = parseInt(e.code.slice(5), 10);
    let changed = false;
    for (const id of selected) {
      const target = state.boxes.find(x => x.id === id) || findTextById(id);
      if (!target) continue;
      if (font === 1) {
        if (target.font) { delete target.font; changed = true; }
      } else if (target.font !== font) {
        target.font = font;
        changed = true;
      }
    }
    if (changed) {
      e.preventDefault();
      scheduleSave();
      renderAll();
    }
    return;
  }
  if (!mod && !e.altKey && (e.key === "+" || e.key === "=" || e.key === "-")) {
    if (selected.size === 0) return;
    const dir = e.key === "-" ? -1 : 1;
    // Capture each box's visual center *before* the shape change so we can
    // re-anchor it after the new shape resizes the element.
    const changes = [];
    for (const id of selected) {
      const bx = state.boxes.find(x => x.id === id);
      if (!bx) continue;
      const cur = boxSides(bx);
      const next = Math.max(3, Math.min(6, cur + dir));
      if (next === cur) continue;
      const elOld = canvas.querySelector(`.box[data-id="${id}"]`);
      const cx = bx.x + (elOld ? elOld.offsetWidth  : 0) / 2;
      const cy = bx.y + (elOld ? elOld.offsetHeight : 0) / 2;
      changes.push({ id, cx, cy });
      if (next === 4) delete bx.sides; else bx.sides = next;
    }
    if (changes.length) {
      e.preventDefault();
      renderAll();
      for (const { id, cx, cy } of changes) {
        const bx = state.boxes.find(x => x.id === id);
        const elNew = canvas.querySelector(`.box[data-id="${id}"]`);
        if (!bx || !elNew) continue;
        bx.x = cx - elNew.offsetWidth  / 2;
        bx.y = cy - elNew.offsetHeight / 2;
        elNew.style.left = bx.x + "px";
        elNew.style.top  = bx.y + "px";
      }
      renderEdges();
      scheduleSave();
    }
    return;
  }
  if (e.key === "Escape") {
    if (isBrushMode()) { setBrushMode(false); return; }
    if (link) { link.handleEl.classList.remove("active"); ghostLine.style.display = "none"; link = null; dropTargetId = null; applyClasses(); clearProximity(); }
    selected.clear();
    selectedEdge = null;
    applyClasses();
    renderEdges();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedEdge) {
      e.preventDefault();
      const idx = state.edges.indexOf(selectedEdge);
      if (idx >= 0) state.edges.splice(idx, 1);
      selectedEdge = null;
      scheduleSave();
      renderEdges();
      setStatus("edge removed");
      return;
    }
    if (selected.size > 0) {
      e.preventDefault();
      deleteSelection();
    }
  }
});

document.getElementById("bg-layer").addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (isBrushMode()) { startStroke(e); return; }
  if (!e.shiftKey) selected.clear();
  if (selectedEdge) { selectedEdge = null; renderEdges(); }
  applyClasses();
  const bandEl = document.createElement("div");
  bandEl.className = "selection-band";
  bandEl.style.left = e.clientX + "px";
  bandEl.style.top = e.clientY + "px";
  bandEl.style.width = "0px";
  bandEl.style.height = "0px";
  document.body.appendChild(bandEl);
  band = { startX: e.clientX, startY: e.clientY, el: bandEl };
});

// Brush mode (paint freehand strokes) lives in ./brush.ts. This call
// supplies the bindings it can't import from main.ts directly because
// they reference live mutable state held here.
wireBrush({
  mintId: () => uid("s"),
  strokeLayer: () => strokeLayer,
  currentMap: () => state,
  scheduleSave: () => scheduleSave(),
  afterCommit: () => renderStrokes(),
  setStatus: (s) => setStatus(s),
});

// On window resize, recenter the map under the new viewport size — viewport-only,
// no data mutation, so the file isn't dirtied.
window.addEventListener("resize", () => {
  recenter();
});

load();
fetch("/version")
  .then(r => r.ok ? r.text() : "")
  .then(t => {
    const v = t.trim();
    if (v) document.getElementById("version").textContent = "flowgo " + v;
  })
  .catch(() => {});

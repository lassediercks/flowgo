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
import {
  isEditing,
  startEdit,
  startTextEdit,
  wireEdit,
} from "./edit.ts";
import {
  applyClasses,
  clearProximity,
  renderAll,
  renderEdges,
  renderLines,
  renderStrokes,
  updateProximity,
  wireProximity,
  wireRender,
} from "./render.ts";
import {
  createBoxAt,
  createLineAt,
  createTextAt,
  deleteSelection,
  wireFactories,
} from "./factories.ts";
import { attachKeyboardListener, wireKeys } from "./keys.ts";
import {
  attachMouseListeners,
  findBoxAt,
  wireMouse,
} from "./mouse.ts";

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
// editing flag lives in ./edit.ts; ask via isEditing()
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

// Render / proximity wiring. The render module reads live state via
// these getters and asks main.ts to attach handlers to freshly built
// DOM nodes (since the handler factories still live here).
wireRender({
  canvas,
  lineLayer,
  strokeLayer,
  edgeLayer,
  currentMap: () => state,
  graph: () => graph,
  currentPath: () => currentPath,
  selected,
  selectedEdge: () => selectedEdge,
  setSelectedEdge: (e) => { selectedEdge = e; },
  dropTargetId: () => dropTargetId,
  nearTargetId: () => nearTargetId,
  attachBoxHandlers: (el, b) => attachBoxHandlers(el, b),
  attachTextHandlers: (el, t) => attachTextHandlers(el, t),
  attachLineHandlers: (g, ln, hit, h1, h2, l) =>
    attachLineHandlers(g, ln, hit, h1, h2, l),
  isBrushMode: () => isBrushMode(),
  setStatus: (s) => setStatus(s),
});
wireProximity({
  canvas,
  currentMap: () => state,
  link: () => link,
  nearTargetId: () => nearTargetId,
  setNearTargetId: (id) => { nearTargetId = id; },
});

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

wireFactories({
  canvas,
  currentMap: () => state,
  setCurrentMap: (m) => { state = m; },
  graph: () => graph,
  setGraph: (g) => { graph = g; },
  currentPath: () => currentPath,
  ensureMap,
  selected,
  selectedEdge: () => selectedEdge,
  clearSelectedEdge: () => { selectedEdge = null; },
  mintId: uid,
  scheduleSave: () => scheduleSave(),
  setStatus: (s) => setStatus(s),
});

wireEdit({
  canvas,
  getCurrentMap: () => state,
  setCurrentMap: (m) => { state = m; },
  getCurrentPath: () => currentPath,
  getGraph: () => graph,
  setGraph: (g) => { graph = g; },
  ensureMap,
  selected,
  scheduleSave: () => scheduleSave(),
  renderAll: () => renderAll(),
  setStatus: (s) => setStatus(s),
});

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

// renderAll / renderEdges / renderLines / renderStrokes / applyClasses /
// updateProximity / clearProximity all live in ./render.ts.

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

// startTextEdit and startEdit live in ./edit.ts.

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

// Document-level mouse handling (mousemove / mouseup / contextmenu /
// auxclick / middle-click pan) plus bg-layer mousedown + dblclick
// live in ./mouse.ts. findBoxAt is exported from there for reuse.

// startEdit lives in ./edit.ts (alongside startTextEdit).

// createBoxAt / createTextAt / createLineAt / deleteSelection live
// in ./factories.ts.



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

// deleteSelection lives in ./factories.ts.

document.getElementById("upBtn").addEventListener("click", goUp);
document.getElementById("downloadBtn").addEventListener("click", downloadFlowgo);
document.getElementById("reshareBtn").addEventListener("click", reshare);

attachHelpListeners();

// Suppress middle-click autoscroll/paste so we can use it for navigation.
// (auxclick is suppressed inside attachMouseListeners.)
window.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }, true);

wireMouse({
  canvas,
  ghostLine,
  currentMap: () => state,
  mintId: () => uid(),
  selected,
  lastCursor,
  drag: () => drag,
  setDrag: (d) => { drag = d; },
  link: () => link,
  setLink: (l) => { link = l; },
  pan: () => pan,
  setPan: (p) => { pan = p; },
  band: () => band,
  setBand: (b) => { band = b; },
  selectedEdge: () => selectedEdge,
  setSelectedEdge: (e) => { selectedEdge = e; },
  dropTargetId: () => dropTargetId,
  setDropTargetId: (id) => { dropTargetId = id; },
  scheduleSave: () => scheduleSave(),
  setStatus: (s) => setStatus(s),
});
attachMouseListeners();

// Document-level keyboard handling lives in ./keys.ts.
wireKeys({
  canvas,
  ghostLine,
  currentMap: () => state,
  findTextById,
  selected,
  selectedEdge: () => selectedEdge,
  setSelectedEdge: (e) => { selectedEdge = e; },
  link: () => link,
  clearLink: () => { link = null; },
  setDropTargetId: (id) => { dropTargetId = id; },
  clearProximity: () => clearProximity(),
  lastCursor,
  scheduleSave: () => scheduleSave(),
  setStatus: (s) => setStatus(s),
});
attachKeyboardListener();


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

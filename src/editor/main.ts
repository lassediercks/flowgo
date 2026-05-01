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
import {
  attachBoxHandlers,
  attachLineHandlers,
  attachTextHandlers,
  collectMovers,
  wireAttach,
} from "./attach.ts";
import { IS_MAC, primaryMod } from "./platform.ts";

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

// IS_MAC and primaryMod live in ./platform.ts.

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

wireAttach({
  canvas,
  lineLayer,
  ghostLine,
  currentMap: () => state,
  findTextById,
  findLineById,
  selected,
  selectedEdge: () => selectedEdge,
  setSelectedEdge: (e) => { selectedEdge = e; },
  setDrag: (d) => { drag = d; },
  setLink: (l) => { link = l; },
  cloneSelection,
  setStatus: (s) => setStatus(s),
});

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

// attachBoxHandlers / attachTextHandlers / attachLineHandlers and
// collectMovers all live in ./attach.ts.

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

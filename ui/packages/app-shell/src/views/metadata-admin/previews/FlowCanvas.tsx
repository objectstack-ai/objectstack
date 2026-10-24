// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowCanvas — an industry-standard visual flowchart designer for flow
 * automation metadata (mirrors Power Automate / Salesforce Flow Builder).
 *
 * Dependency-free: no reactflow/@xyflow. Nodes are absolutely-positioned
 * Shadcn cards over an SVG edge layer, laid out top-to-bottom by a
 * deterministic layered algorithm (`flow-canvas-layout`). Authors can:
 *
 *   - drag to reposition nodes (committed to the spec's `node.position = {x,y}`
 *     on drop — objectui#3172),
 *   - add a node from the ONE add-node palette, whichever "+" opened it
 *     (objectui#11778): the toolbar's Add node and a node's bottom "+" put it
 *     after that node in its path (`placeAfter`), the "+" at an edge's
 *     midpoint splits that edge A→B into A→N→B; the new node is left unpinned
 *     so the layered auto-layout places it,
 *   - connect two nodes the flow already has (objectui#11905): press the
 *     connect handle (the dot on a card's bottom edge, beside its "+"), drag
 *     and drop on another node. The new edge is the one a "+" would draw out
 *     of that node (`outEdge`); `edgeConnectionRefusal` (`flow-problems`),
 *     the rule the edge inspector's From / To also call, refuses a node to
 *     itself, a pair already connected and a node the flow does not have, and
 *     the reason shows in the alert stack. Dropped on no node, the drag is let
 *     go and nothing is written,
 *   - delete the selected node (Delete/Backspace) with full edge cleanup,
 *   - pan (background drag) and zoom / fit-to-view.
 *
 * Selection is delegated to the existing FlowNodeInspector via
 * onSelectionChange — the canvas never duplicates the inspector.
 *
 * The component is a pure renderer of `draft`; all mutations go through
 * `onPatch(partial)` and the host merges + persists.
 */

import * as React from 'react';
import { AlertCircle, AlertTriangle, Maximize2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@object-ui/components';
import { uniqueId, appendArray, spliceArray } from '../inspectors/_shared.js';
import { t as tr, tFormat } from '../i18n.js';
import {
  computeLayoutWithGeometry,
  NODE_W,
  NODE_H,
  bottomAnchor,
  topAnchor,
  rightAnchor,
  edgePath,
  forwardEdgeRoute,
  backEdgePath,
  backEdgeLabelAnchor,
  isBackEdge,
  edgeKey,
  conditionText,
  extractRegions,
  withCanonicalGeometry,
  type FlowDesignerNode,
  type FlowDesignerEdge,
  type Point,
  type LabeledRegion,
} from './flow-canvas-layout.js';
import { predictExpandedNodeHeight } from './flow-region-metrics.js';
import { NodeCard, NodePalette, defaultNodeLabel, defaultNodeExtras, flowEdgeDisplayName, flowNodeDisplayName } from './flow-canvas-parts.js';
import { useFlowNodePalette } from './useFlowNodePalette.js';
import {
  indexProblemBadges,
  edgeProblemKey,
  describeEdgeConnectionRefusal,
  describeNodeRemovalRefusal,
  edgeConnectionRefusal,
  edgesAfterNodeRemoval,
  freshNodeId,
  nodeRemovalRefusal,
  type EdgeConnectionRefusal,
  type FlowProblem,
} from './flow-problems.js';
import type { NestedNodePath } from '../inspectors/flow-nested-selection.js';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const DRAG_THRESHOLD = 4;

interface DragState {
  nodeId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface PanState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

/**
 * objectui#11905 — a drag from a node's connect handle, while it lasts. Kept in
 * a ref (the window listeners read it), mirrored into state for the preview.
 */
interface ConnectState {
  /** The node whose handle was pressed: the new edge's source. */
  source: string;
  /** Client coordinates of the press. */
  startX: number;
  startY: number;
  /** Past `DRAG_THRESHOLD`: a press that never moves is let go, not refused. */
  moved: boolean;
  /** The pointer, in canvas coordinates: the preview line's loose end. */
  pointer: Point;
  /** The node under the pointer, if any. */
  overId: string | null;
}

/** Horizontal offset of the connect handle from the card's centre: clear of the 24px "+" there. */
const CONNECT_HANDLE_DX = 36;
/** The connect handle's diameter. */
const CONNECT_HANDLE_SIZE = 14;

export interface FlowCanvasProps {
  nodes: FlowDesignerNode[];
  edges: FlowDesignerEdge[];
  editable: boolean;
  designMode: boolean;
  selectedId: string | null;
  /** Stable key (see `edgeKey`) of the currently-selected edge, or null. */
  selectedEdgeId?: string | null;
  locale?: string;
  /** Simulation overlay: currently-executing node. */
  activeNodeId?: string | null;
  /** Simulation overlay: nodes already executed. */
  visitedNodeIds?: string[];
  /** Simulation overlay: ids of edges that were traversed. */
  traversedEdgeIds?: string[];
  /** Structural-validation: node ids to paint with a red error ring. */
  invalidNodeIds?: string[];
  /** Structural-validation: edges (keyed `${source}->${target}`) to paint red. */
  invalidEdges?: ReadonlySet<string>;
  /**
   * Select + reveal a problem when its inline-banner row is clicked — wired to
   * the same handler the Problems panel uses, so the always-visible banner is
   * actionable without opening the panel.
   */
  onRevealProblem?: (problem: FlowProblem) => void;
  /**
   * Unified validation issues (structural + server) rendered as per-element
   * badges; the Problems panel shares the same list.
   */
  problems?: FlowProblem[];
  /**
   * Imperative "reveal" request from the Problems panel: when `nonce` changes
   * the canvas pans to center the targeted node/edge. Selection highlight is
   * driven separately via `selectedId` / `selectedEdgeId`.
   */
  revealSignal?: { target: FlowProblem['target']; nonce: number } | null;
  onSelect: (node: FlowDesignerNode | null) => void;
  /** Select an edge (its `edgeKey`), or clear selection with `null`. */
  onSelectEdge?: (edge: FlowDesignerEdge | null, key: string) => void;
  /**
   * #2670 Phase 3: the selected NESTED node (inside an expanded container's
   * region), or null. Drives the selection ring on the matching container's
   * tray node.
   */
  selectedNestedPath?: NestedNodePath | null;
  /**
   * #2670 Phase 3: select a nested node (pass its full path + the node), or
   * clear the nested selection with `null`. Absent → the region trays stay
   * read-only (Phase 2 behavior).
   */
  onSelectNested?: (path: NestedNodePath | null, node?: FlowDesignerNode) => void;
  onPatch?: (partial: Record<string, unknown>) => void;
  /**
   * objectui#11772 — the host's id minter for a new node, when the host keeps
   * an editing session (`FlowPreview` remembers every node id it has seen, so
   * a removed node's id is never minted again). Absent, the canvas mints with
   * `freshNodeId` (`flow-problems`) over the draft alone.
   */
  mintNodeId?: () => string;
}

export function FlowCanvas({
  nodes: storedNodes,
  edges,
  editable,
  designMode,
  selectedId,
  selectedEdgeId,
  locale,
  activeNodeId,
  visitedNodeIds,
  traversedEdgeIds,
  invalidNodeIds,
  invalidEdges,
  onRevealProblem,
  problems,
  revealSignal,
  onSelect,
  onSelectEdge,
  selectedNestedPath,
  onSelectNested,
  onPatch,
  mintNodeId,
}: FlowCanvasProps) {
  // objectui#3172 — the ONE geometry boundary: nodes enter the canvas with the
  // retired `ui: {x,y}` spelling already lifted onto the spec's `position`, so
  // every patch below is built from canonical nodes and no write path can
  // re-emit `ui` (the compiler cannot catch that for us — `FlowDesignerNode`
  // has an index signature). Same reference when nothing needed migrating, so
  // the memos keyed on `nodes` are unaffected.
  const nodes = React.useMemo(() => withCanonicalGeometry(storedNodes), [storedNodes]);

  const viewportRef = React.useRef<HTMLDivElement>(null);
  // objectui#11795 — the viewport width the diagram was last framed at (the
  // mount centering, or a re-fit after the canvas's width changed).
  const framedWidthRef = React.useRef<number | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState<Point>({ x: 0, y: 0 });
  // objectui#11778 — which "+" has the add-node palette open: `toolbar`,
  // `edge:<edgeKey>` or `node:<id>`; null when none. One key, so at most one
  // palette is ever open and a pick closes it wherever it was opened.
  const [paletteAt, setPaletteAt] = React.useState<string | null>(null);
  // Node types offered by the add-node palette, driven by the engine's
  // published descriptors (`GET /api/v1/automation/actions`) merged with the
  // hardcoded base — so the palette reflects what the backend actually supports
  // (e.g. the `approval` node, third-party connector actions).
  const paletteItems = useFlowNodePalette();

  // Transient drag position override (commit-on-drop) so rapid pointer moves
  // never spam onPatch and never diverge from the persisted draft.
  const [dragPos, setDragPos] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const panRef = React.useRef<PanState | null>(null);

  // #2670: structured-region containers. Which nodes carry regions (memoized so
  // NodeCard props keep a stable identity), which are expanded (session-only
  // view state — never written to the draft), and the per-node height feeding
  // the geometry-aware layout (expanded container = predicted card height;
  // everything else = NODE_H, keeping the historical layout byte-identical).
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = React.useCallback(
    (id: string) => {
      // Read the current expand state OUTSIDE the updater so we can clear a
      // now-hidden nested selection on collapse (D6) — a plain effect keyed on
      // expandedIds would also fire when the canvas remounts (expandedIds resets
      // to empty) and wrongly clear a still-valid selection.
      const collapsing = expandedIds.has(id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (collapsing && selectedNestedPath?.containerId === id) onSelectNested?.(null);
    },
    [expandedIds, selectedNestedPath, onSelectNested],
  );
  const regionsByNode = React.useMemo(() => {
    const map = new Map<string, LabeledRegion[]>();
    for (const n of nodes) {
      const regions = extractRegions(n);
      if (regions.length > 0) map.set(n.id, regions);
    }
    return map;
  }, [nodes]);
  const nodeHeights = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) {
      const regions = expandedIds.has(n.id) ? regionsByNode.get(n.id) : undefined;
      map.set(n.id, regions ? predictExpandedNodeHeight(regions) : NODE_H);
    }
    return map;
  }, [nodes, regionsByNode, expandedIds]);

  const { positions: layout, heights, size } = React.useMemo(
    () => computeLayoutWithGeometry(nodes, edges, (n) => nodeHeights.get(n.id) ?? NODE_H),
    [nodes, edges, nodeHeights],
  );

  // Simulation overlay sets (display-only; never drives engine behavior).
  const visitedSet = React.useMemo(() => new Set(visitedNodeIds ?? []), [visitedNodeIds]);
  const traversedSet = React.useMemo(() => new Set(traversedEdgeIds ?? []), [traversedEdgeIds]);
  const invalidNodeSet = React.useMemo(() => new Set(invalidNodeIds ?? []), [invalidNodeIds]);
  const simRunning = (visitedNodeIds?.length ?? 0) > 0 || !!activeNodeId;

  // Per-element validation badges (errors dominate warnings on the same
  // element). Derived from the live `problems` list so badges clear as issues
  // are resolved.
  const { byNode: nodeBadges, byEdge: edgeBadges } = React.useMemo(
    () => indexProblemBadges(problems ?? []),
    [problems],
  );

  // Error-level problems shown in the always-visible inline banner — driven by
  // the same `problems` list as the panel/badges so the three stay in lock-step.
  const bannerErrors = React.useMemo(() => (problems ?? []).filter((p) => p.level === 'error'), [problems]);

  // objectui#11838 — the node whose Delete-key removal was refused. Its message
  // sits at the top of that same inline alert stack, derived from the draft
  // while the node stays selected: it names what still blocks the removal, and
  // goes away once nothing does or another element is selected. Reset while
  // rendering when the selection moves (the pattern `FlowNodeIdField` uses), so
  // re-selecting the node does not bring back a refusal nobody asked for again.
  const [deleteRefusedId, setDeleteRefusedId] = React.useState<string | null>(null);
  // objectui#11905 — a drag from a connect handle while it lasts (`ConnectState`),
  // and the connection the last drop was refused. Its reason sits in the same
  // alert stack until the next press on the canvas or a change of selection.
  const connectRef = React.useRef<ConnectState | null>(null);
  const [connectView, setConnectView] = React.useState<ConnectState | null>(null);
  const [connectRefused, setConnectRefused] = React.useState<{
    source: string;
    target: string;
    refusal: EdgeConnectionRefusal;
  } | null>(null);
  const [refusalSelection, setRefusalSelection] = React.useState(selectedId);
  if (refusalSelection !== selectedId) {
    setRefusalSelection(selectedId);
    setDeleteRefusedId(null);
    setConnectRefused(null);
  }
  const deleteRefusal = React.useMemo(() => {
    if (!deleteRefusedId || deleteRefusedId !== selectedId) return null;
    const sites = nodeRemovalRefusal({ nodes, edges }, deleteRefusedId);
    return sites ? describeNodeRemovalRefusal(deleteRefusedId, sites, locale) : null;
  }, [deleteRefusedId, selectedId, nodes, edges, locale]);
  const connectRefusal = connectRefused
    ? describeEdgeConnectionRefusal(connectRefused.refusal, connectRefused.source, connectRefused.target, locale)
    : null;

  const positionOf = React.useCallback(
    (id: string): Point => {
      if (dragPos && dragPos.id === id) return { x: dragPos.x, y: dragPos.y };
      return layout.get(id) ?? { x: 0, y: 0 };
    },
    [dragPos, layout],
  );

  // objectui#13144 — every card's box as drawn (a dragged card where it is
  // being dragged), so a forward edge is routed around a card it would cross.
  const nodeBoxes = nodes.map((n) => {
    const p = positionOf(n.id);
    return { id: n.id, x: p.x, y: p.y, width: NODE_W, height: heights.get(n.id) ?? NODE_H };
  });
  const forwardRoute = (
    source: string,
    target: string,
    from: Point,
    to: Point,
    labelSize?: { width: number; height: number },
  ) => forwardEdgeRoute(from, to, nodeBoxes.filter((b) => b.id !== source && b.id !== target), labelSize);

  // ── Mutations ────────────────────────────────────────────────────────────

  const persistPosition = React.useCallback(
    (id: string, x: number, y: number) => {
      if (!onPatch) return;
      const idx = nodes.findIndex((n) => n.id === id);
      if (idx < 0) return;
      const node = nodes[idx];
      const nextNode: FlowDesignerNode = { ...node, position: { x, y } };
      onPatch({ nodes: spliceArray(nodes, idx, nextNode) });
    },
    [nodes, onPatch],
  );

  // objectui#11772 — the one place this canvas names a node it adds: the
  // host's session minter when it keeps one, else `freshNodeId` over the draft.
  const newNodeId = React.useCallback(
    () => (mintNodeId ? mintNodeId() : freshNodeId(nodes, edges)),
    [mintNodeId, nodes, edges],
  );

  const addNode = React.useCallback(
    (type: string, opts?: { from?: string; at?: Point }) => {
      if (!onPatch) return;
      const id = newNodeId();
      const label = defaultNodeLabel(type, locale);
      // Only an explicit `at` pins a manual position. A `from`-append is left
      // unpinned so the layered auto-layout slots it below its parent and
      // spaces it horizontally among siblings — pinning it directly under the
      // parent (the old behavior) made every sibling stack on the same spot.
      const at = opts?.at;
      const newNode: FlowDesignerNode = {
        id,
        type,
        label,
        ...defaultNodeExtras(type),
        ...(at ? { position: { x: at.x, y: at.y } } : {}),
      };
      const nextNodes = appendArray(nodes, newNode);
      const patch: Record<string, unknown> = { nodes: nextNodes };
      if (opts?.from) patch.edges = appendArray(edges, outEdge(opts.from, id, nodes, edges));
      onPatch(patch);
      onSelect(newNode);
      setPaletteAt(null);
    },
    [edges, nodes, onPatch, onSelect, positionOf, locale, newNodeId],
  );

  /**
   * Split edge A→B by inserting a new node N of the picked `type`: A→N (keeps
   * guard) + N→B. objectui#11778 — N is left unpinned, like a `from`-append, so
   * the layered auto-layout gives it its own layer between A and B. Pinning it
   * at the endpoints' midpoint (the old behavior) dropped it half a layer below
   * A, on top of the cards it sat between.
   */
  const insertOnEdge = React.useCallback(
    (edge: FlowDesignerEdge, type: string) => {
      if (!onPatch) return;
      const edgeIdx = edges.findIndex((e) => e === edge);
      if (edgeIdx < 0) return;
      const id = newNodeId();
      const newNode: FlowDesignerNode = {
        id,
        type,
        label: defaultNodeLabel(type, locale),
        ...defaultNodeExtras(type),
      };
      // A→N inherits the original edge's branch semantics; N→B is plain.
      const firstSegment: FlowDesignerEdge = { ...edge, target: id };
      const secondSegment: FlowDesignerEdge = {
        id: uniqueId('edge', [...edges.map((e) => e.id).filter(Boolean) as string[], 'edge']),
        source: id,
        target: edge.target,
      };
      const nextEdges = spliceArray(edges, edgeIdx, firstSegment);
      onPatch({ nodes: appendArray(nodes, newNode), edges: appendArray(nextEdges, secondSegment) });
      onSelect(newNode);
      setPaletteAt(null);
    },
    [edges, nodes, onPatch, onSelect, locale, newNodeId],
  );

  /**
   * objectui#11778 — add a node of the picked `type` AFTER `anchorId`, in its
   * path: the one rule the toolbar's Add node (anchor: the selected node, else
   * Start) and a node's bottom "+" (anchor: that node) share. `placeAfter`
   * decides where; this only dispatches to the insert or the append.
   */
  const addAfter = React.useCallback(
    (anchorId: string | null, type: string) => {
      const place = placeAfter(anchorId, nodes, edges);
      if (place.kind === 'split') insertOnEdge(place.edge, type);
      else addNode(type, place.kind === 'from' ? { from: place.from } : undefined);
    },
    [nodes, edges, insertOnEdge, addNode],
  );

  /** Open/close wiring for the add-node palette behind one "+" (see `paletteAt`). */
  const paletteFor = (key: string) => ({
    locale,
    items: paletteItems,
    open: paletteAt === key,
    onOpenChange: (open: boolean) => setPaletteAt(open ? key : null),
  });

  /**
   * ADR-0044 one-click "add revision loop": drop a signal `wait` node plus the
   * two edges that form a send-back-for-revision loop on an approval node —
   * a `revise` out-edge to the wait point, and a declared `back`-edge closing
   * the loop (resubmit re-enters the approval node as round N+1). Reproduces the
   * canonical `showcase_budget_approval` shape in a single gesture. The wait
   * node is left unpinned so the layered auto-layout slots it among the
   * approval node's other branches.
   */
  const addReviseLoop = React.useCallback(
    (approvalId: string) => {
      if (!onPatch) return;
      if (!nodes.some((n) => n.id === approvalId)) return;
      const waitId = newNodeId();
      const waitNode: FlowDesignerNode = {
        id: waitId,
        type: 'wait',
        label: tr('engine.flowCanvas.awaitingRevision', locale),
        // Signal-flavored wait: the submitter's resubmit signal resumes the run.
        // No `onTimeout` — retired in spec 17 (framework#4158); writing it makes
        // `FlowNodeSchema.parse()` reject the node this button just created.
        waitEventConfig: { eventType: 'signal', signalName: 'revision' },
      };
      const existingEdgeIds = edges.map((e) => e.id).filter(Boolean) as string[];
      const reviseId = uniqueId('edge', existingEdgeIds);
      const backId = uniqueId('edge', [...existingEdgeIds, reviseId]);
      const reviseEdge: FlowDesignerEdge = { id: reviseId, source: approvalId, target: waitId, label: 'revise' };
      const backEdge: FlowDesignerEdge = { id: backId, source: waitId, target: approvalId, label: 'resubmit', type: 'back' };
      onPatch({
        nodes: appendArray(nodes, waitNode),
        edges: appendArray(appendArray(edges, reviseEdge), backEdge),
      });
      onSelect(waitNode);
    },
    [edges, nodes, onPatch, onSelect, locale, newNodeId],
  );

  // Approval nodes that already declare a `revise` out-edge — used to hide the
  // "add revision loop" affordance once a loop exists (avoid duplicates).
  const reviseLoopSources = React.useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) {
      if (typeof e.label === 'string' && e.label.trim().toLowerCase() === 'revise') s.add(e.source);
    }
    return s;
  }, [edges]);

  const deleteNode = React.useCallback(
    (id: string) => {
      if (!onPatch) return;
      // objectui#11838 — the inspector's "Remove node" rule: refused, writing
      // nothing, while a boundary event's host or an expression root still
      // names the node. The refusal is shown in the alert stack above.
      if (nodeRemovalRefusal({ nodes, edges }, id)) {
        setDeleteRefusedId(id);
        return;
      }
      const nextNodes = nodes.filter((n) => n.id !== id);
      // objectui#11772 — the same removal the inspector's "Remove node" makes.
      const nextEdges = edgesAfterNodeRemoval(edges, id, new Set(nextNodes.map((n) => n.id)));
      onPatch({ nodes: nextNodes, edges: nextEdges });
      onSelect(null);
    },
    [edges, nodes, onPatch, onSelect],
  );

  // ── Drag (reposition) — pointer capture, commit on pointer-up ──────────────

  const onNodePointerDown = React.useCallback(
    (id: string) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // objectui#11546 — a press on a node that answers it (a drag when
      // editable, a select in design mode) is the node's, never the
      // background's. Reaching `onBgPointerDown` clears the selection and takes
      // pointer capture on the viewport, so the browser fires the click at the
      // viewport and the node's own select never runs. A read-only design
      // canvas withholds only the drag; a press on a node that answers neither
      // still pans.
      if (!editable && !designMode) return;
      e.stopPropagation();
      setConnectRefused(null);
      if (!editable) return;
      const origin = positionOf(id);
      dragRef.current = {
        nodeId: id,
        startX: e.clientX,
        startY: e.clientY,
        originX: origin.x,
        originY: origin.y,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [designMode, editable, positionOf],
  );

  const onNodePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;
      setDragPos({ id: d.nodeId, x: Math.max(0, d.originX + dx), y: Math.max(0, d.originY + dy) });
    },
    [zoom],
  );

  const onNodePointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (d.moved && dragPos) {
        persistPosition(d.nodeId, Math.round(dragPos.x), Math.round(dragPos.y));
      }
      setDragPos(null);
    },
    [dragPos, persistPosition],
  );

  // ── Connect (objectui#11905): drag from a connect handle, drop on a node ───

  /** Client coordinates to canvas coordinates: the inverse of the pan/zoom transform. */
  const toCanvasPoint = React.useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = viewportRef.current?.getBoundingClientRect();
      return { x: (clientX - (rect?.left ?? 0) - pan.x) / zoom, y: (clientY - (rect?.top ?? 0) - pan.y) / zoom };
    },
    [pan.x, pan.y, zoom],
  );

  /**
   * The node of THIS canvas a pointer event is over: the card (its
   * `data-node-id` element) holding the element the browser hit-tests at the
   * event's point, else the one holding the event's own target. The hit-test
   * comes first because a touch pointer is captured by the handle it pressed,
   * so its release targets the handle rather than the card under the finger.
   */
  const nodeUnder = React.useCallback(
    (e: PointerEvent): string | null => {
      const idOf = (el: unknown): string | null => {
        const vp = viewportRef.current;
        if (!vp || !el || typeof (el as Element).closest !== 'function' || !vp.contains(el as Node)) return null;
        const id = (el as Element).closest('[data-node-id]')?.getAttribute('data-node-id');
        return id && nodes.some((n) => n.id === id) ? id : null;
      };
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
      return idOf(hit) ?? idOf(e.target);
    },
    [nodes],
  );

  const onConnectPointerDown = React.useCallback(
    (source: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !editable) return;
      // The press is the handle's: not a pan or a selection clear (the
      // viewport's), not a card drag, and no text selection while it lasts.
      e.stopPropagation();
      e.preventDefault();
      setConnectRefused(null);
      const state: ConnectState = {
        source,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointer: toCanvasPoint(e.clientX, e.clientY),
        overId: null,
      };
      connectRef.current = state;
      setConnectView(state);
    },
    [editable, toCanvasPoint],
  );

  /** The drop: connect the source to the node under the pointer, or say why not. */
  const finishConnect = React.useCallback(
    (e: PointerEvent) => {
      const c = connectRef.current;
      connectRef.current = null;
      setConnectView(null);
      if (!c || !c.moved || !onPatch) return;
      const target = nodeUnder(e);
      if (!target) return;
      const refusal = edgeConnectionRefusal({ nodes, edges }, c.source, target);
      if (refusal) {
        setConnectRefused({ source: c.source, target, refusal });
        return;
      }
      const edge = outEdge(c.source, target, nodes, edges);
      // The patch holds the edges alone: no node is rewritten, so a node that
      // is reconnected keeps its configuration exactly as stored.
      onPatch({ edges: appendArray(edges, edge) });
      onSelectEdge?.(edge, edgeKey(edge, edges.length));
    },
    [edges, nodes, nodeUnder, onPatch, onSelectEdge],
  );

  // While a connect drag lasts the window carries it, so a release outside the
  // viewport still ends it; Escape or a cancelled pointer lets it go.
  const connecting = connectView !== null;
  React.useEffect(() => {
    if (!connecting) return;
    const move = (e: PointerEvent) => {
      const c = connectRef.current;
      if (!c) return;
      const next: ConnectState = {
        ...c,
        moved: c.moved || Math.hypot(e.clientX - c.startX, e.clientY - c.startY) >= DRAG_THRESHOLD,
        pointer: toCanvasPoint(e.clientX, e.clientY),
        overId: nodeUnder(e),
      };
      connectRef.current = next;
      setConnectView(next);
    };
    const cancel = () => {
      connectRef.current = null;
      setConnectView(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finishConnect);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finishConnect);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [connecting, finishConnect, nodeUnder, toCanvasPoint]);

  // ── Pan (background drag) ──────────────────────────────────────────────────

  const onBgPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      setConnectRefused(null);
      onSelect(null);
      panRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [onSelect, pan.x, pan.y],
  );

  const onBgPointerMove = React.useCallback((e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    setPan({ x: p.originX + (e.clientX - p.startX), y: p.originY + (e.clientY - p.startY) });
  }, []);

  const onBgPointerUp = React.useCallback((e: React.PointerEvent) => {
    if (panRef.current) (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    panRef.current = null;
  }, []);

  // ── Zoom / fit ─────────────────────────────────────────────────────────────

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const fitToView = React.useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const pad = 32;
    const zx = (vp.clientWidth - pad) / size.width;
    const zy = (vp.clientHeight - pad) / size.height;
    // No `, 1` cap here: clampZoom already bounds this to MAX_ZOOM (1.6). A
    // small flow (most flows are 2-4 linear nodes) used to freeze at 100% —
    // fit-to-view should actually fit, i.e. zoom IN to use the available
    // canvas, not just center a tiny diagram in a sea of blank space.
    const z = clampZoom(Math.min(zx, zy));
    setZoom(z);
    setPan({
      x: (vp.clientWidth - size.width * z) / 2,
      y: Math.max(16, (vp.clientHeight - size.height * z) / 2),
    });
  }, [size.height, size.width]);

  // Center the diagram at 100% on mount so opening a flow shows a familiar 1:1
  // scale with the diagram centered — rather than an auto-fit that zoomed small
  // (2-4 node) flows up to 160%. Centering (not pan-{0,0}) keeps the diagram
  // from being stranded in a corner. Authors can still zoom / fit-to-view from
  // the toolbar. Deliberately mount-only (not re-run on every `size` change):
  // re-centering on every node add/drag would yank the viewport out from under
  // an actively editing user.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    setZoom(1);
    setPan({
      x: (vp.clientWidth - size.width) / 2,
      y: Math.max(16, (vp.clientHeight - size.height) / 2),
    });
    framedWidthRef.current = vp.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // objectui#11795 — re-fit when the canvas's own WIDTH changes: a window
  // resize, the Studio chat dock opening or closing, a side panel toggled
  // beside the canvas. Without it the mount framing outlived its width: opened
  // narrow and then widened, the diagram stayed where the narrow box put it,
  // its cards clipped at the left edge. The fit is the toolbar's, capped at
  // 100% so a small flow is not zoomed up past the scale it opens at.
  //
  // Width only, never height, which keeps the promise above: the size changes
  // an edit causes are vertical — a held-edit or refused-save notice landing
  // above the canvas, a Problems list growing under it — and must not yank the
  // viewport from under the author. A node add, drag or edit changes the
  // diagram, not the canvas, and re-arms this observer at the width it already
  // framed, so it moves nothing. A 0 width is a hidden canvas: nothing to fit.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const width = vp.clientWidth;
      if (width === 0 || width === framedWidthRef.current) return;
      framedWidthRef.current = width;
      const pad = 32;
      // 1 is under MAX_ZOOM, so only the MIN_ZOOM floor of `clampZoom` can bind.
      const z = Math.max(MIN_ZOOM, Math.min(1, (width - pad) / size.width, (vp.clientHeight - pad) / size.height));
      setZoom(z);
      setPan({
        x: (width - size.width * z) / 2,
        y: Math.max(16, (vp.clientHeight - size.height * z) / 2),
      });
    });
    observer.observe(vp);
    return () => observer.disconnect();
  }, [size.height, size.width]);

  // Pan to center an element when the Problems panel asks to reveal it. Driven
  // by a changing `nonce` so re-clicking the same problem re-centers it.
  React.useEffect(() => {
    if (!revealSignal) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const t = revealSignal.target;
    let pt: Point | null = null;
    if (t.kind === 'node') {
      const p = layout.get(t.nodeId);
      // #2670: center on the card's true (possibly expanded) height.
      if (p) pt = { x: p.x + NODE_W / 2, y: p.y + (heights.get(t.nodeId) ?? NODE_H) / 2 };
    } else if (t.kind === 'edge') {
      const s = layout.get(t.source);
      const d = layout.get(t.target);
      // The edge's pill point as actually drawn (source bottom → target top,
      // around any card it would cross — objectui#13144).
      if (s && d) {
        const edge = edges.find((e) => e.source === t.source && e.target === t.target);
        pt = forwardRoute(
          t.source,
          t.target,
          bottomAnchor(s, heights.get(t.source) ?? NODE_H),
          topAnchor(d),
          edge && branchPillSize(edge),
        ).label;
      }
    }
    if (pt) setPan({ x: vp.clientWidth / 2 - pt.x * zoom, y: vp.clientHeight / 2 - pt.y * zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSignal?.nonce]);

  // ── Keyboard: delete selected node ─────────────────────────────────────────

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!editable || !selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        deleteNode(selectedId);
      }
    },
    [deleteNode, editable, selectedId],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  // objectui#11905 — the node a connect drag is over, and whether a drop there
  // would be refused (the ring drawn on it says which).
  const connectTarget =
    connectView?.moved && connectView.overId
      ? {
          id: connectView.overId,
          at: positionOf(connectView.overId),
          refused: edgeConnectionRefusal({ nodes, edges }, connectView.source, connectView.overId) !== null,
        }
      : null;

  // Where an edge leaves and enters, and where its branch pill sits.
  const edgeEnds = (edge: FlowDesignerEdge) => {
    const sp = layout.get(edge.source);
    const tp = layout.get(edge.target);
    if (!sp || !tp) return null;
    // ADR-0044 back-edges (revise loop) re-enter an earlier node, so
    // they attach to the right side of both endpoints and render as a
    // dashed amber return arc — visually distinct from the forward
    // top-to-bottom flow.
    const back = isBackEdge(edge);
    const sPos = dragPos?.id === edge.source ? positionOf(edge.source) : sp;
    const tPos = dragPos?.id === edge.target ? positionOf(edge.target) : tp;
    // #2670: an expanded container's outgoing edge leaves from its
    // TRUE bottom (heights map; drag-independent). Back-edges stay on
    // the header band via rightAnchor, so toggling never swings arcs.
    const from = back ? rightAnchor(sPos) : bottomAnchor(sPos, heights.get(edge.source) ?? NODE_H);
    const to = back ? rightAnchor(tPos) : topAnchor(tPos);
    if (back) return { back, from, to, d: backEdgePath(from, to), labelPos: backEdgeLabelAnchor(from, to) };
    // objectui#13144 — a forward edge that would cross a card it skips detours
    // around it; its pill, insert handle and wide hit path all follow the route.
    const route = forwardRoute(edge.source, edge.target, from, to, branchPillSize(edge));
    return { back, from, to, d: route.d, labelPos: route.label };
  };
  // objectui#13242 — an edge end as its hover title names it: by the rule, and
  // by its id only where no node answers to it.
  const endName = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    return node ? flowNodeDisplayName(node, locale) : id;
  };
  // objectui#12507 — each edge's branch pill: its text, its full wording, and
  // how wide it may draw before it would reach a neighbouring pill.
  const branchLabels = layoutBranchLabels(edges.map((edge) => {
    const label = branchLabelOf(edge);
    const ends = label && edgeEnds(edge);
    return label && ends ? { ...label, at: ends.labelPos } : undefined;
  }));

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden">
      {/* Inline structural-validation banner (ADR-0044 cycle surfacing): shows
          errors directly on the canvas so the author needn't open Debug. Each row
          with a concrete target is clickable — it selects + pans to the offending
          node/edge (the same reveal the Problems panel does). */}
      {(deleteRefusal || connectRefusal || bannerErrors.length > 0) && (
        <div className="absolute left-2 top-2 z-30 max-w-[min(60%,420px)] space-y-1">
          {[deleteRefusal, connectRefusal].map((refusal, i) =>
            refusal ? (
              <p
                key={i}
                role="alert"
                className="flex w-full items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-left text-[11px] leading-snug text-destructive shadow-sm backdrop-blur-sm"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{refusal}</span>
              </p>
            ) : null,
          )}
          {bannerErrors.slice(0, 3).map((p) => {
            const clickable = !!onRevealProblem && p.target.kind !== 'flow';
            return (
              <button
                key={p.id}
                type="button"
                role="alert"
                disabled={!clickable}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={clickable ? (e) => { e.stopPropagation(); onRevealProblem!(p); } : undefined}
                title={clickable ? tr('engine.flowCanvas.reveal', locale) : undefined}
                className={cn(
                  'flex w-full items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-left text-[11px] leading-snug text-destructive shadow-sm backdrop-blur-sm transition-colors',
                  clickable && 'cursor-pointer hover:border-destructive/60 hover:bg-destructive/20',
                )}
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{p.message}</span>
              </button>
            );
          })}
          {bannerErrors.length > 3 && (
            <div className="px-2.5 text-[10px] text-destructive/80">{tFormat('engine.flowCanvas.moreErrors', locale, { count: bannerErrors.length - 3 })}</div>
          )}
        </div>
      )}
      {/* Toolbar: Add node at the top right, while the canvas is editable. */}
      {editable && (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
          <NodePalette {...paletteFor('toolbar')} onPick={(type) => addAfter(selectedId, type)}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {tr('engine.inspector.add.node', locale)}
            </button>
          </NodePalette>
        </div>
      )}
      {/* objectui#12454 — the zoom control floats at the bottom right: −,
          the percentage, +, then fit after a divider. */}
      <div className="absolute bottom-4 right-4 z-30 flex items-center gap-0.5 rounded-lg border bg-background p-[3px] shadow-sm">
        <button
          type="button"
          title={tr('engine.flowCanvas.zoomOut', locale)}
          aria-label={tr('engine.flowCanvas.zoomOut', locale)}
          onClick={() => setZoom((z) => clampZoom(z - 0.15))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[44px] text-center text-xs tabular-nums text-foreground/80">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          title={tr('engine.flowCanvas.zoomIn', locale)}
          aria-label={tr('engine.flowCanvas.zoomIn', locale)}
          onClick={() => setZoom((z) => clampZoom(z + 0.15))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <span aria-hidden className="mx-0.5 h-[18px] w-px bg-border" />
        <button
          type="button"
          title={tr('engine.flowCanvas.fit', locale)}
          aria-label={tr('engine.flowCanvas.fit', locale)}
          onClick={fitToView}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label={tr('engine.flowCanvas.canvas', locale)}
        onKeyDown={onKeyDown}
        onPointerDown={onBgPointerDown}
        onPointerMove={(e) => {
          onBgPointerMove(e);
          onNodePointerMove(e);
        }}
        onPointerUp={(e) => {
          onBgPointerUp(e);
          onNodePointerUp(e);
        }}
        // objectui#12454 — the sidebar surface with a 20 px dot grid, as the
        // redesign's canvas reads; the dots stay on the border token.
        className="h-full w-full cursor-grab bg-sidebar outline-none active:cursor-grabbing"
        style={{
          // Dot grid tied to pan + zoom so the surface tracks the diagram
          // (rather than floating behind a static texture).
          backgroundImage:
            'radial-gradient(circle at 1px 1px, hsl(var(--border)) 1px, transparent 0)',
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: size.width,
            height: size.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* Edge layer */}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={size.width}
            height={size.height}
          >
            <defs>
              <marker
                id="flow-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/55" />
              </marker>
              {/* Distinct amber arrowhead for ADR-0044 back-edges (revise loop). */}
              <marker
                id="flow-arrow-back"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-amber-500/80" />
              </marker>
              {/* Red arrowhead for edges flagged by structural validation. */}
              <marker
                id="flow-arrow-error"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-destructive" />
              </marker>
            </defs>
            {edges.map((edge, i) => {
              const ends = edgeEnds(edge);
              if (!ends) return null;
              const { back, d, labelPos } = ends;
              // Structural-validation error (e.g. part of an un-declared cycle).
              // Back-edges are excluded from cycle detection, so they're never invalid.
              const invalid = !back && !!invalidEdges?.has(`${edge.source}->${edge.target}`);
              const branch = branchLabels[i];
              const eid = edgeKey(edge, i);
              const edgeBadge = edgeBadges.get(edgeProblemKey(edge.source, edge.target));
              const traversed = traversedSet.has(eid);
              const selected = selectedEdgeId === eid;
              // Edges are selectable in design mode; the host opens the edge
              // inspector. A wide transparent hit-path widens the click target
              // beyond the 1.5px visible stroke without altering the visuals.
              const selectable = designMode && !!onSelectEdge;
              return (
                <g key={edge.id || `${edge.source}-${edge.target}-${i}`} data-invalid={invalid || undefined}>
                  <path
                    d={d}
                    strokeLinecap="round"
                    strokeDasharray={back ? '5 4' : undefined}
                    className={cn(
                      'fill-none transition-[stroke] duration-150',
                      traversed
                        ? 'stroke-sky-500'
                        : selected
                          ? 'stroke-primary'
                          : invalid
                            ? 'stroke-destructive'
                            : back
                              ? 'stroke-amber-500/70'
                              : simRunning
                                ? 'stroke-muted-foreground/20'
                                : 'stroke-muted-foreground/40',
                    )}
                    strokeWidth={traversed || selected || invalid ? 2.5 : 1.75}
                    markerEnd={invalid ? 'url(#flow-arrow-error)' : back ? 'url(#flow-arrow-back)' : 'url(#flow-arrow)'}
                  />
                  {selectable && (
                    <path
                      d={d}
                      className="pointer-events-auto cursor-pointer fill-none stroke-transparent"
                      strokeWidth={14}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEdge!(edge, eid);
                      }}
                    >
                      <title>
                        {invalid
                          ? tFormat('engine.flowCanvas.edge.undeclaredCycle', locale, { source: endName(edge.source), target: endName(edge.target) })
                          : back
                            ? tFormat('engine.flowCanvas.edge.backEdge', locale, { source: endName(edge.source), target: endName(edge.target) })
                            : flowEdgeDisplayName(edge, nodes, locale)}
                      </title>
                    </path>
                  )}
                  {branch && (
                    <foreignObject
                      x={labelPos.x - branch.width / 2}
                      y={labelPos.y - 11}
                      width={branch.width}
                      height={22}
                      className={cn(selectable && 'pointer-events-auto')}
                    >
                      <div className="flex justify-center">
                        <span
                          data-branch-label=""
                          title={branch.title}
                          onPointerDown={selectable ? (e) => e.stopPropagation() : undefined}
                          onClick={selectable ? (e) => { e.stopPropagation(); onSelectEdge!(edge, eid); } : undefined}
                          className={cn(
                            'max-w-full truncate rounded-full border bg-background/95 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm transition-colors',
                            selectable && 'cursor-pointer hover:border-primary/60',
                            selected
                              ? 'border-primary text-primary'
                              : invalid
                                ? 'border-destructive/60 text-destructive'
                                : back
                                  ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                                  : 'border-border text-muted-foreground',
                          )}
                        >
                          {branch.text}
                        </span>
                      </div>
                    </foreignObject>
                  )}
                  {edgeBadge && (
                    <foreignObject
                      x={labelPos.x - 9}
                      y={labelPos.y - 30}
                      width={18}
                      height={18}
                      className="pointer-events-auto overflow-visible"
                    >
                      <span
                        title={edgeBadge.title}
                        data-problem={edgeBadge.level}
                        className={cn(
                          'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background shadow-sm',
                          edgeBadge.level === 'error'
                            ? 'border-destructive/50 text-destructive'
                            : 'border-amber-500/50 text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {edgeBadge.level === 'error' ? (
                          <AlertCircle className="h-3 w-3" />
                        ) : (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                      </span>
                    </foreignObject>
                  )}
                  {editable && !back && (
                    <foreignObject
                      // Sit the insert handle at the edge midpoint, but slide it
                      // to the right of the branch-label pill when one is present
                      // so the two don't stack on the same spot.
                      x={branch ? labelPos.x + branch.handleX : labelPos.x - 11}
                      y={labelPos.y - 11}
                      width={22}
                      height={22}
                      className="pointer-events-auto"
                    >
                      {/* objectui#11778 — the same palette as the toolbar's;
                          the pick splits THIS edge. */}
                      <NodePalette {...paletteFor(`edge:${eid}`)} onPick={(type) => insertOnEdge(edge, type)}>
                        <button
                          type="button"
                          title={tr('engine.flowCanvas.insertNode', locale)}
                          aria-label={tr('engine.flowCanvas.insertNode', locale)}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-background/90 text-muted-foreground opacity-50 shadow-sm backdrop-blur-sm transition-all hover:scale-110 hover:border-primary hover:bg-background hover:text-primary hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </NodePalette>
                    </foreignObject>
                  )}
                </g>
              );
            })}
            {/* objectui#11905 — the connection a connect drag would draw, from
                the source's bottom anchor (where the edge will leave) to the
                pointer. */}
            {connectView?.moved && (
              <path
                data-connect-preview=""
                d={edgePath(
                  bottomAnchor(positionOf(connectView.source), heights.get(connectView.source) ?? NODE_H),
                  connectView.pointer,
                )}
                strokeDasharray="6 4"
                strokeWidth={2}
                className="fill-none stroke-primary"
                markerEnd="url(#flow-arrow)"
              />
            )}
          </svg>

          {/* Node layer */}
          {nodes.map((node) => {
            const runState = activeNodeId === node.id ? 'active' : visitedSet.has(node.id) ? 'visited' : undefined;
            const pos = positionOf(node.id);
            return (
              <React.Fragment key={node.id}>
                <NodeCard
                  id={node.id}
                  locale={locale}
                  type={node.type}
                  label={node.label || node.id}
                  summary={nodeSummary(node, locale)}
                  position={pos}
                  selected={selectedId === node.id}
                  editable={editable}
                  runState={runState}
                  dimmed={simRunning && !runState}
                  onPointerDown={onNodePointerDown(node.id)}
                  onSelect={() => designMode && onSelect(node)}
                  onAppend={(type) => addAfter(node.id, type)}
                  paletteItems={paletteItems}
                  appendPaletteOpen={paletteAt === `node:${node.id}`}
                  onAppendPaletteOpenChange={(open) => setPaletteAt(open ? `node:${node.id}` : null)}
                  onAddReviseLoop={
                    editable && node.type === 'approval' && !reviseLoopSources.has(node.id)
                      ? () => addReviseLoop(node.id)
                      : undefined
                  }
                  invalid={invalidNodeSet.has(node.id)}
                  badge={nodeBadges.get(node.id)}
                  regions={regionsByNode.get(node.id)}
                  expanded={expandedIds.has(node.id)}
                  onToggleExpand={regionsByNode.has(node.id) ? () => toggleExpanded(node.id) : undefined}
                  height={heights.get(node.id)}
                  selectedNestedNode={
                    selectedNestedPath?.containerId === node.id
                      ? { regionKey: selectedNestedPath.regionKey, nodeId: selectedNestedPath.nodeId }
                      : null
                  }
                  onSelectNestedNode={
                    designMode && onSelectNested
                      ? (regionKey, nested) =>
                          onSelectNested({ containerId: node.id, regionKey, nodeId: nested.id }, nested)
                      : undefined
                  }
                />
                {/* objectui#11905 — the connect handle: press, drag, drop on
                    another node. On the card's bottom edge beside its "+", and,
                    like the "+", absent on an End, which has no way on. A
                    pointer gesture only: the keyboard re-points an existing
                    connection in the edge inspector's From / To. */}
                {editable && node.type !== 'end' && (
                  <span
                    aria-hidden
                    title={tr('engine.flowCanvas.connect', locale)}
                    data-connect-handle={node.id}
                    onPointerDown={onConnectPointerDown(node.id)}
                    className={cn(
                      'absolute z-10 cursor-crosshair touch-none rounded-full border-2 bg-background shadow-sm transition-[transform,border-color] duration-150 hover:scale-125 hover:border-primary',
                      connectView?.source === node.id ? 'scale-125 border-primary' : 'border-muted-foreground/50',
                    )}
                    style={{
                      left: pos.x + NODE_W / 2 + CONNECT_HANDLE_DX - CONNECT_HANDLE_SIZE / 2,
                      top: pos.y + (heights.get(node.id) ?? NODE_H) - CONNECT_HANDLE_SIZE / 2,
                      width: CONNECT_HANDLE_SIZE,
                      height: CONNECT_HANDLE_SIZE,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {/* objectui#11905 — the node a connect drag is over: ringed in the
              primary colour when the drop would connect, in the destructive one
              when `edgeConnectionRefusal` would refuse it. */}
          {connectTarget && (
            <div
              aria-hidden
              data-connect-target={connectTarget.refused ? 'refused' : 'connects'}
              className={cn(
                'pointer-events-none absolute z-20 rounded-xl ring-2 ring-offset-2 ring-offset-background',
                connectTarget.refused ? 'ring-destructive' : 'ring-primary',
              )}
              style={{
                left: connectTarget.at.x,
                top: connectTarget.at.y,
                width: NODE_W,
                height: heights.get(connectTarget.id) ?? NODE_H,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The edge drawn out of `fromId` to `targetId`: by a node's "+" and the
 * toolbar's Add node when they append (`addNode`), and by a drag from the
 * node's connect handle (objectui#11905), so a connection reads the same
 * whichever of them drew it. A fresh `edge` id; when the source is a decision,
 * its matching branch (by order: the k-th out-edge takes the k-th branch) is
 * carried onto the edge so it actually routes. The decision's
 * `config.conditions` are otherwise disconnected from the edges, leaving every
 * branch unconditional.
 */
function outEdge(
  fromId: string,
  targetId: string,
  nodes: FlowDesignerNode[],
  edges: FlowDesignerEdge[],
): FlowDesignerEdge {
  const edge: FlowDesignerEdge = {
    id: uniqueId('edge', edges.map((e) => e.id).filter(Boolean) as string[]),
    source: fromId,
    target: targetId,
  };
  const fromNode = nodes.find((n) => n.id === fromId);
  if (fromNode?.type === 'decision') {
    const branches = Array.isArray(fromNode.config?.conditions)
      ? (fromNode.config!.conditions as Array<Record<string, unknown>>)
      : [];
    const outCount = edges.filter((e) => e.source === fromId).length;
    const branch = branches[outCount];
    if (branch && typeof branch === 'object') {
      const expr = typeof branch.expression === 'string' ? branch.expression.trim() : '';
      const label = typeof branch.label === 'string' ? branch.label.trim() : '';
      if (label) edge.label = label;
      if (expr === 'true') edge.isDefault = true;
      else if (expr) edge.condition = expr;
    }
  }
  return edge;
}

/**
 * Node types whose out-edges ARE their outcomes: a decision's branches, an
 * approval's `approve` / `reject`, a BPMN fan-out. A node added after one of
 * these is a new outcome, never a step spliced into an outcome already wired.
 */
const BRANCHING_NODE_TYPES: ReadonlySet<string> = new Set(['decision', 'approval', 'parallel_gateway']);

/** Where `placeAfter` puts a new node. */
type Placement =
  /** Split this edge, exactly as its own "+" would. */
  | { kind: 'split'; edge: FlowDesignerEdge }
  /** A new out-edge from this node (a decision carries its next branch). */
  | { kind: 'from'; from: string }
  /** No edge at all: there is no path to put it in. */
  | { kind: 'loose' };

/**
 * objectui#11778 — the one rule for "add a node after this one", so the
 * toolbar's Add node and a node's bottom "+" can never disagree. The anchor is
 * `anchorId` when it names a node, else the flow's Start.
 *
 *   - a branching anchor (`BRANCHING_NODE_TYPES`), or one that already fans
 *     out to two or more nodes → a new branch from it: there is no single path
 *     after it to put the node in;
 *   - an anchor with exactly one way on → split that edge (anchor → N → next),
 *     the new node takes the old one's place in the path;
 *   - an anchor with no way on → append (anchor → N);
 *   - an End anchor has no "after": the node goes BEFORE it, splitting its one
 *     way in; an End reached by several paths, or none, has no single path in
 *     — loose, as is a flow with no Start and nothing selected.
 *
 * "A way on" is a forward edge (never an ADR-0044 back-edge) between two
 * distinct nodes that both exist; an edge naming a missing node is not a path
 * (objectui#11772 leaves those for the Problems panel to name, unrepaired).
 */
function placeAfter(anchorId: string | null, nodes: FlowDesignerNode[], edges: FlowDesignerEdge[]): Placement {
  const live = new Set(nodes.map((n) => n.id));
  const anchor = nodes.find((n) => n.id === anchorId) ?? nodes.find((n) => n.type === 'start');
  if (!anchor) return { kind: 'loose' };
  const isWayOn = (e: FlowDesignerEdge) =>
    !isBackEdge(e) && e.source !== e.target && live.has(e.source) && live.has(e.target);
  if (anchor.type === 'end') {
    const waysIn = edges.filter((e) => e.target === anchor.id && isWayOn(e));
    return waysIn.length === 1 ? { kind: 'split', edge: waysIn[0] } : { kind: 'loose' };
  }
  const waysOn = edges.filter((e) => e.source === anchor.id && isWayOn(e));
  if (waysOn.length === 1 && !BRANCHING_NODE_TYPES.has(anchor.type)) return { kind: 'split', edge: waysOn[0] };
  return { kind: 'from', from: anchor.id };
}

/** objectui#12507 — a branch pill reads at most this many characters, then an ellipsis. */
const BRANCH_LABEL_MAX_CHARS = 32;
/** The pill's height on the artboard (`h-[22px]` box), and the clear space kept between two pills. */
const BRANCH_PILL_H = 22;
const BRANCH_PILL_GAP = 8;
/**
 * A rough width for one character of the pill's `text-[10px]` face, plus its
 * padding and border. It only places the insert handle beside the pill; the
 * pill itself is laid out by the browser and truncates inside its box.
 */
const BRANCH_PILL_CHAR_W = 6;
const BRANCH_PILL_CHROME_W = 18;

interface BranchLabel {
  /** What the pill prints: one line, clamped to {@link BRANCH_LABEL_MAX_CHARS}. */
  text: string;
  /** The full wording: the edge's own label and its condition, one per line. */
  title?: string;
}

/**
 * objectui#12507 — the words on a branch edge. The author's own `label` reads
 * first; an edge without one reads `if ` and its condition; a default edge
 * reads `else`. The text is clamped by characters, so a long CEL condition
 * cannot run across its sibling or a node card, and the full wording rides
 * in `title` (the edge inspector still edits the condition itself).
 */
function branchLabelOf(edge: FlowDesignerEdge): BranchLabel | undefined {
  if (edge.isDefault) return { text: 'else' };
  const cond = conditionText(edge.condition);
  const ifCond = cond ? `if ${cond}` : undefined;
  const full = edge.label || ifCond;
  if (!full) return undefined;
  const chars = Array.from(full);
  const text = chars.length > BRANCH_LABEL_MAX_CHARS ? `${chars.slice(0, BRANCH_LABEL_MAX_CHARS).join('')}…` : full;
  return { text, title: [edge.label, ifCond].filter(Boolean).join('\n') };
}

/**
 * objectui#13144 — the most room a branch pill can take (its text at the
 * per-character estimate, at most a node card wide), which the edge router keeps
 * clear of every card. Undefined for an edge that draws no pill.
 */
function branchPillSize(edge: FlowDesignerEdge): { width: number; height: number } | undefined {
  const label = branchLabelOf(edge);
  if (!label) return undefined;
  const width = Math.min(NODE_W, Array.from(label.text).length * BRANCH_PILL_CHAR_W + BRANCH_PILL_CHROME_W);
  return { width, height: BRANCH_PILL_H };
}

/**
 * Give each branch pill a box no wider than a node card and no wider than the
 * distance to the nearest other pill on the same band, so two pills never
 * draw over each other (sibling outcomes of one decision sit half a column
 * apart). `handleX` is how far right of the pill's centre the insert handle
 * goes so it clears the pill.
 */
function layoutBranchLabels(
  labels: ReadonlyArray<(BranchLabel & { at: Point }) | undefined>,
): Array<(BranchLabel & { width: number; handleX: number }) | undefined> {
  return labels.map((label, i) => {
    if (!label) return undefined;
    let width = NODE_W;
    labels.forEach((other, j) => {
      if (!other || j === i || Math.abs(other.at.y - label.at.y) >= BRANCH_PILL_H) return;
      width = Math.min(width, Math.abs(other.at.x - label.at.x) - BRANCH_PILL_GAP);
    });
    width = Math.max(width, BRANCH_PILL_H * 2);
    const drawn = Math.min(width, Array.from(label.text).length * BRANCH_PILL_CHAR_W + BRANCH_PILL_CHROME_W);
    return { ...label, width, handleX: drawn / 2 + 6 };
  });
}

/**
 * One-line config summary shown on the node card (best-effort, type-aware).
 * The words it adds of its own (a branch count, an approver count, `code`)
 * read in the designer `locale` (objectui#10862); config values pass through.
 */
function nodeSummary(node: FlowDesignerNode, locale?: string): string | undefined {
  const c = node.config as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const block = (key: string, inner: string) => {
    const b = (node as Record<string, unknown>)[key];
    return b && typeof b === 'object' ? str((b as Record<string, unknown>)[inner]) : undefined;
  };
  const pick = (k: string) => (c ? str(c[k]) : undefined);
  // A string inside a nested config object (e.g. config.schedule.expression), so an
  // object-shaped descriptor summarizes as its value, not "[object Object]".
  const cfgBlock = (key: string, inner: string) => {
    const b = c?.[key];
    return b && typeof b === 'object' && !Array.isArray(b) ? str((b as Record<string, unknown>)[inner]) : undefined;
  };
  if (node.type === 'start') {
    return (
      pick('condition') ||
      pick('criteria') ||
      pick('objectName') ||
      cfgBlock('schedule', 'expression') ||
      cfgBlock('schedule', 'cron') ||
      pick('cron') ||
      pick('schedule') ||
      cfgBlock('timeRelative', 'object') ||
      pick('triggerType')
    );
  }
  if (node.type === 'decision') {
    const conds = c?.conditions;
    if (Array.isArray(conds) && conds.length) {
      const labels = conds
        .map((x) => (x && typeof x === 'object' ? str((x as Record<string, unknown>).label) : undefined))
        .filter(Boolean);
      return labels.length
        ? labels.join(' / ')
        : tFormat('engine.flowCanvas.summary.branches', locale, { count: conds.length });
    }
    return pick('condition');
  }
  if (node.type === 'script') {
    // The function IS the step (framework#4343). The rest are retired keys a
    // stored node may still carry — kept as fallbacks so its subtitle is never
    // blank before someone migrates it.
    return (
      pick('function') ||
      pick('actionType') ||
      pick('template') ||
      (c && c.script ? tr('engine.flowCanvas.summary.code', locale) : undefined)
    );
  }
  if (node.type === 'approval') {
    const approvers = c?.approvers;
    const n = Array.isArray(approvers) ? approvers.length : 0;
    const behavior = pick('behavior');
    if (n > 0) {
      const count = tFormat(
        n === 1 ? 'engine.flowCanvas.summary.approversOne' : 'engine.flowCanvas.summary.approversOther',
        locale,
        { count: n },
      );
      return behavior === 'unanimous' ? `${count} · ${tr('engine.flowCanvas.summary.unanimous', locale)}` : count;
    }
    return behavior || undefined;
  }
  return (
    pick('objectName') ||
    block('connectorConfig', 'actionId') ||
    block('waitEventConfig', 'timerDuration') ||
    block('waitEventConfig', 'eventType') ||
    block('boundaryConfig', 'eventType') ||
    pick('condition') ||
    pick('flowName') ||
    pick('url') ||
    pick('collection') ||
    pick('action') ||
    pick('flow') ||
    pick('event') ||
    pick('duration') ||
    undefined
  );
}


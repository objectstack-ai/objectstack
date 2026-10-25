/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { BPMNNode, BPMNEdge, BPMNLane, DesignerCanvasConfig } from '@object-ui/types';
import {
  Play, Square, Diamond, Trash2, GitBranch,
  Undo2, Redo2, Copy, Clipboard, ZoomIn, ZoomOut, RotateCcw,
  Link, Layout, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useMultiSelect } from './hooks/useMultiSelect';
import { useClipboard } from './hooks/useClipboard';
import { useCanvasPanZoom } from './hooks/useCanvasPanZoom';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PropertyEditor, type PropertyField } from './components/PropertyEditor';
import { Minimap } from './components/Minimap';
import { useCollaboration } from './CollaborationProvider';
import { CANVAS_BACKGROUND_CLASS, canvasBackgroundStyle } from './canvasBackground';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

/** Node dimensions used for edge routing and minimap */
const NODE_WIDTH = 120;
const NODE_HEIGHT = 50;

/** The space a lane band keeps around its nodes, and the height of a lane none of whose nodes is on the canvas. */
const LANE_PADDING = 24;
const EMPTY_LANE_HEIGHT = 80;

/** The `lanes` default, one array so the lane bands are not recomputed on every render. */
const NO_LANES: BPMNLane[] = [];

/** The property-panel field name prefix that routes an edit into a node's `properties` record. */
const NODE_PROPERTY_PREFIX = 'properties.';

interface LaneBand {
  lane: BPMNLane;
  top: number;
  height: number;
  members: number;
}

/**
 * One band per lane, spanning the canvas width and the vertical extent of the
 * nodes `nodeIds` names, padded. A lane none of whose nodes is on the canvas
 * still draws, below the bands drawn before it.
 */
function laneBands(lanes: BPMNLane[], nodes: BPMNNode[]): LaneBand[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let bottom = 0;
  return lanes.map((lane) => {
    const members = lane.nodeIds
      .map((id) => byId.get(id))
      .filter((n): n is BPMNNode => n !== undefined);
    if (members.length === 0) {
      const band = { lane, top: bottom, height: EMPTY_LANE_HEIGHT, members: 0 };
      bottom += EMPTY_LANE_HEIGHT;
      return band;
    }
    const top = Math.max(0, Math.min(...members.map((n) => n.position.y)) - LANE_PADDING);
    const end = Math.max(...members.map((n) => n.position.y + NODE_HEIGHT)) + LANE_PADDING;
    bottom = Math.max(bottom, end);
    return { lane, top, height: end - top, members: members.length };
  });
}

/** A version as the toolbar draws it: `1.2` reads `v1.2`, and a version already spelled `v2` is left alone. */
function versionLabel(version: string): string {
  return /^v/i.test(version) ? version : `v${version}`;
}

/**
 * The property-panel field for one entry of a node's `properties` record, with
 * a control for the value's type. A value that is not a string, number or
 * boolean is edited as JSON, and an edit is committed only when it parses.
 */
function nodePropertyField(key: string, value: unknown): PropertyField {
  const base = { name: `${NODE_PROPERTY_PREFIX}${key}`, label: key, group: 'Properties' };
  if (typeof value === 'boolean') return { ...base, type: 'boolean', value };
  if (typeof value === 'number') return { ...base, type: 'number', value };
  if (typeof value === 'string') return { ...base, type: 'text', value };
  let json: string;
  try {
    json = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    json = String(value);
  }
  return { ...base, type: 'textarea', value: json, description: 'JSON — an edit is kept once it parses' };
}

/** The value a property-panel edit commits for a `properties` entry, or `undefined` when it does not parse. */
function nodePropertyValue(previous: unknown, input: unknown): { value: unknown } | undefined {
  if (typeof previous === 'string' || typeof previous === 'number' || typeof previous === 'boolean') {
    return { value: input };
  }
  try {
    return { value: JSON.parse(String(input)) };
  } catch {
    return undefined;
  }
}

export interface ProcessDesignerProps {
  /** Process name */
  processName?: string;
  /** Process version */
  version?: string;
  /** BPMN nodes */
  nodes?: BPMNNode[];
  /** BPMN edges */
  edges?: BPMNEdge[];
  /** Swim lanes */
  lanes?: BPMNLane[];
  /** Canvas configuration */
  canvas?: DesignerCanvasConfig;
  /** Show minimap */
  showMinimap?: boolean;
  /** Show toolbar */
  showToolbar?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Callback when nodes change */
  onNodesChange?: (nodes: BPMNNode[]) => void;
  /** Callback when edges change */
  onEdgesChange?: (edges: BPMNEdge[]) => void;
  /** Custom CSS class */
  className?: string;
}

interface DesignerSnapshot {
  nodes: BPMNNode[];
  edges: BPMNEdge[];
}

/**
 * Auto-layout: arrange nodes left-to-right based on edge topology.
 * Roots (no incoming edges) are placed first; each subsequent layer
 * is offset horizontally by `hGap`.
 */
function autoLayoutNodes(nodes: BPMNNode[], edges: BPMNEdge[]): BPMNNode[] {
  if (nodes.length === 0) return nodes;

  const hGap = 200;
  const vGap = 100;
  const incomingCount = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const n of nodes) {
    incomingCount.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
    children.get(e.source)?.push(e.target);
  }

  const layers: string[][] = [];
  const placed = new Set<string>();
  let currentLayer = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0).map((n) => n.id);

  if (currentLayer.length === 0) {
    currentLayer = [nodes[0].id];
  }

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    for (const id of currentLayer) placed.add(id);
    const nextSet = new Set<string>();
    for (const id of currentLayer) {
      for (const child of children.get(id) ?? []) {
        if (!placed.has(child)) nextSet.add(child);
      }
    }
    currentLayer = Array.from(nextSet);
  }

  // Place any remaining unconnected nodes
  const remaining = nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
  if (remaining.length > 0) layers.push(remaining);

  const positionMap = new Map<string, { x: number; y: number }>();
  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col];
    for (let row = 0; row < layer.length; row++) {
      positionMap.set(layer[row], {
        x: 80 + col * hGap,
        y: 80 + row * vGap,
      });
    }
  }

  return nodes.map((n) => ({
    ...n,
    position: positionMap.get(n.id) ?? n.position,
  }));
}

/**
 * Process designer for creating BPMN 2.0 workflows.
 * Supports nodes, edges, lanes, and conditional flows: the toolbar draws the
 * `version` beside the process name, each lane is a band around the nodes it
 * names, a flow draws its `condition` in brackets and BPMN's slash marker when
 * it `isDefault`, and the property panel offers a node's task members
 * (`assignee`, `dueDate`, `script`) and each of its `properties` (objectui#11434).
 *
 * Phase 2-4 features: undo/redo, confirm dialogs, multi-select,
 * copy/paste, pan/zoom, minimap, edge creation UI, auto-layout,
 * property editor, drag-and-drop, collaboration, keyboard shortcuts,
 * and collapsible panels.
 */
export function ProcessDesigner({
  processName = 'New Process',
  version,
  nodes: initialNodes = [],
  edges: initialEdges = [],
  lanes = NO_LANES,
  canvas = { width: 1400, height: 800, showGrid: true },
  showMinimap: showMinimapProp = true,
  showToolbar = true,
  readOnly = false,
  onNodesChange,
  onEdgesChange,
  className,
}: ProcessDesignerProps) {
  // ---- Undo / Redo ----
  const undoRedo = useUndoRedo<DesignerSnapshot>(
    { nodes: initialNodes, edges: initialEdges },
    { maxHistory: 50 },
  );
  const nodes = undoRedo.current.nodes;
  const edges = undoRedo.current.edges;

  const pushSnapshot = useCallback(
    (nextNodes: BPMNNode[], nextEdges: BPMNEdge[]) => {
      undoRedo.push({ nodes: nextNodes, edges: nextEdges });
      onNodesChange?.(nextNodes);
      onEdgesChange?.(nextEdges);
    },
    [undoRedo, onNodesChange, onEdgesChange],
  );

  // ---- Confirmation dialog ----
  const confirmDialog = useConfirmDialog();

  // ---- Multi-select ----
  const multiSelect = useMultiSelect();

  // ---- Clipboard ----
  const clipboard = useClipboard<BPMNNode[]>();

  // ---- Pan / Zoom ----
  const panZoom = useCanvasPanZoom({ initialZoom: 1 });

  // ---- Collaboration (optional context) ----
  const collaboration = useCollaboration();

  // ---- Local UI state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showPropertyPanel, setShowPropertyPanel] = useState(true);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const onNodesChangeRef = useRef(onNodesChange);
  const onEdgesChangeRef = useRef(onEdgesChange);
  onNodesChangeRef.current = onNodesChange;
  onEdgesChangeRef.current = onEdgesChange;

  // ---- Sync from undo/redo back to parent when undo/redo triggers ----
  useEffect(() => {
    onNodesChangeRef.current?.(nodes);
    onEdgesChangeRef.current?.(edges);
  }, [undoRedo.current]);

  // ---- Add node ----
  const handleAddNode = useCallback(
    (type: BPMNNode['type'], label: string) => {
      if (readOnly) return;
      const newNode: BPMNNode = {
        id: `node-${Date.now()}`,
        type,
        label,
        position: { x: 200 + nodes.length * 160, y: 200 },
      };
      const updatedNodes = [...nodes, newNode];
      pushSnapshot(updatedNodes, edges);
      setSelectedNodeId(newNode.id);
      multiSelect.selectOne(newNode.id);
      collaboration?.sendOperation({ type: 'insert', elementId: newNode.id, data: { label }, userId: collaboration.currentUserId ?? '' });
    },
    [nodes, edges, readOnly, pushSnapshot, multiSelect, collaboration],
  );

  // ---- Delete node (with confirmation) ----
  const handleDeleteNode = useCallback(
    async (id: string) => {
      if (readOnly) return;
      const node = nodes.find((n) => n.id === id);
      const confirmed = await confirmDialog.confirm(
        'Delete Node',
        `Are you sure you want to delete "${node?.label ?? id}"? This will also remove all connected edges.`,
      );
      if (!confirmed) return;

      const updatedNodes = nodes.filter((n) => n.id !== id);
      const updatedEdges = edges.filter((e) => e.source !== id && e.target !== id);
      pushSnapshot(updatedNodes, updatedEdges);
      if (selectedNodeId === id) setSelectedNodeId(null);
      multiSelect.clearSelection();
      collaboration?.sendOperation({ type: 'delete', elementId: id, data: {}, userId: collaboration.currentUserId ?? '' });
    },
    [nodes, edges, selectedNodeId, readOnly, pushSnapshot, confirmDialog, multiSelect, collaboration],
  );

  // ---- Delete multiple selected nodes ----
  const handleDeleteSelected = useCallback(async () => {
    if (readOnly || multiSelect.count === 0) return;
    const confirmed = await confirmDialog.confirm(
      'Delete Selected Nodes',
      `Are you sure you want to delete ${multiSelect.count} selected node(s) and their connected edges?`,
    );
    if (!confirmed) return;

    const ids = multiSelect.selectedIds;
    const updatedNodes = nodes.filter((n) => !ids.has(n.id));
    const updatedEdges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    pushSnapshot(updatedNodes, updatedEdges);
    setSelectedNodeId(null);
    multiSelect.clearSelection();
  }, [nodes, edges, readOnly, pushSnapshot, confirmDialog, multiSelect]);

  // ---- Copy selected nodes ----
  const handleCopy = useCallback(() => {
    const ids = multiSelect.count > 0 ? multiSelect.selectedIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());
    if (ids.size === 0) return;
    const toCopy = nodes.filter((n) => ids.has(n.id));
    clipboard.copy(toCopy);
  }, [nodes, selectedNodeId, multiSelect, clipboard]);

  // ---- Paste from clipboard ----
  const handlePaste = useCallback(() => {
    if (readOnly) return;
    const items = clipboard.paste();
    if (!items || items.length === 0) return;
    const offset = 40;
    const pasted = items.map((n) => ({
      ...n,
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      position: { x: n.position.x + offset, y: n.position.y + offset },
    }));
    const updatedNodes = [...nodes, ...pasted];
    pushSnapshot(updatedNodes, edges);
    multiSelect.selectMany(pasted.map((n) => n.id));
    setSelectedNodeId(pasted[0].id);
  }, [readOnly, nodes, edges, clipboard, pushSnapshot, multiSelect]);

  // ---- Edge creation (connect mode) ----
  const handleToggleConnectMode = useCallback(() => {
    setConnectMode((prev) => {
      if (prev) {
        setConnectSource(null);
        return false;
      }
      return true;
    });
  }, []);

  const handleNodeClickForConnect = useCallback(
    (nodeId: string) => {
      if (!connectMode) return false;
      if (!connectSource) {
        setConnectSource(nodeId);
        return true;
      }
      if (connectSource === nodeId) return true; // same node — ignore
      // Create edge
      const newEdge: BPMNEdge = {
        id: `edge-${Date.now()}`,
        source: connectSource,
        target: nodeId,
      };
      const updatedEdges = [...edges, newEdge];
      pushSnapshot(nodes, updatedEdges);
      setConnectSource(null);
      setConnectMode(false);
      collaboration?.sendOperation({ type: 'insert', elementId: newEdge.id, data: { source: connectSource, target: nodeId }, userId: collaboration.currentUserId ?? '' });
      return true;
    },
    [connectMode, connectSource, nodes, edges, pushSnapshot, collaboration],
  );

  // ---- Auto layout ----
  const handleAutoLayout = useCallback(() => {
    if (readOnly || nodes.length === 0) return;
    const layouted = autoLayoutNodes(nodes, edges);
    pushSnapshot(layouted, edges);
  }, [nodes, edges, readOnly, pushSnapshot]);

  // ---- Drag-and-drop to reposition nodes ----
  const handleDragStart = useCallback(
    (e: React.DragEvent, nodeId: string) => {
      if (readOnly) return;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setDragNodeId(nodeId);
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', nodeId);
    },
    [readOnly, nodes],
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly || !dragNodeId) return;
      const canvasRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const zoom = panZoom.zoom;
      const x = (e.clientX - canvasRect.left - panZoom.panOffset.x) / zoom - dragOffset.x;
      const y = (e.clientY - canvasRect.top - panZoom.panOffset.y) / zoom - dragOffset.y;
      const snappedX = Math.max(0, Math.round(x / 20) * 20);
      const snappedY = Math.max(0, Math.round(y / 20) * 20);
      const updatedNodes = nodes.map((n) =>
        n.id === dragNodeId ? { ...n, position: { x: snappedX, y: snappedY } } : n,
      );
      pushSnapshot(updatedNodes, edges);
      setDragNodeId(null);
    },
    [readOnly, dragNodeId, dragOffset, nodes, edges, panZoom.zoom, panZoom.panOffset, pushSnapshot],
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // ---- Property editor fields for selected node ----
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  const propertyFields: PropertyField[] = useMemo(() => {
    if (!selectedNode) return [];
    const fields: PropertyField[] = [
      { name: 'label', label: 'Name', type: 'text' as const, value: selectedNode.label, group: 'General' },
      {
        name: 'type', label: 'Type', type: 'select' as const, value: selectedNode.type,
        options: [
          { label: 'Start Event', value: 'start-event' },
          { label: 'End Event', value: 'end-event' },
          { label: 'User Task', value: 'user-task' },
          { label: 'Service Task', value: 'service-task' },
          { label: 'Script Task', value: 'script-task' },
          { label: 'Exclusive Gateway', value: 'exclusive-gateway' },
          { label: 'Parallel Gateway', value: 'parallel-gateway' },
          { label: 'Inclusive Gateway', value: 'inclusive-gateway' },
        ],
        group: 'General',
      },
      { name: 'description', label: 'Description', type: 'textarea' as const, value: selectedNode.description ?? '', group: 'General' },
    ];
    // The task members: offered on the task type they belong to, and on any
    // node that already carries a value, so an authored value is never hidden.
    const isUserTask = selectedNode.type === 'user-task';
    if (isUserTask || selectedNode.assignee !== undefined) {
      fields.push({ name: 'assignee', label: 'Assignee', type: 'text', value: selectedNode.assignee ?? '', group: 'Task' });
    }
    if (isUserTask || selectedNode.dueDate !== undefined) {
      fields.push({
        name: 'dueDate', label: 'Due date', type: 'text', value: selectedNode.dueDate ?? '', group: 'Task',
        description: 'A date or duration expression',
      });
    }
    if (selectedNode.type === 'script-task' || selectedNode.script !== undefined) {
      fields.push({ name: 'script', label: 'Script', type: 'textarea', value: selectedNode.script ?? '', group: 'Task' });
    }
    for (const [key, value] of Object.entries(selectedNode.properties ?? {})) {
      fields.push(nodePropertyField(key, value));
    }
    return fields;
  }, [selectedNode]);

  const handlePropertyChange = useCallback(
    (name: string, value: unknown) => {
      if (readOnly || !selectedNodeId) return;
      let committed = true;
      const updatedNodes = nodes.map((n) => {
        if (n.id !== selectedNodeId) return n;
        if (name.startsWith(NODE_PROPERTY_PREFIX)) {
          const key = name.slice(NODE_PROPERTY_PREFIX.length);
          const next = nodePropertyValue(n.properties?.[key], value);
          if (!next) {
            committed = false;
            return n;
          }
          return { ...n, properties: { ...n.properties, [key]: next.value } };
        }
        return { ...n, [name]: value };
      });
      if (!committed) return;
      pushSnapshot(updatedNodes, edges);
    },
    [readOnly, selectedNodeId, nodes, edges, pushSnapshot],
  );

  // ---- Swim lanes ----
  const bands = useMemo(() => laneBands(lanes, nodes), [lanes, nodes]);

  // ---- Node styling (preserved from original) ----
  const getNodeStyle = (type: BPMNNode['type']) => {
    switch (type) {
      case 'start-event':
        return 'rounded-full bg-green-100 border-green-500 text-green-700';
      case 'end-event':
        return 'rounded-full bg-red-100 border-red-500 text-red-700';
      case 'exclusive-gateway':
      case 'parallel-gateway':
      case 'inclusive-gateway':
      case 'event-based-gateway':
        return 'rotate-45 bg-yellow-100 border-yellow-500 text-yellow-700';
      case 'user-task':
        return 'rounded bg-blue-100 border-blue-500 text-blue-700';
      case 'service-task':
      case 'script-task':
        return 'rounded bg-purple-100 border-purple-500 text-purple-700';
      default:
        return 'rounded bg-gray-100 border-gray-500 text-gray-700';
    }
  };

  // ---- Minimap items ----
  const minimapItems = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        selected: multiSelect.isSelected(n.id) || n.id === selectedNodeId,
      })),
    [nodes, multiSelect, selectedNodeId],
  );

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl+Z — Undo
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
        return;
      }
      // Ctrl+Y or Ctrl+Shift+Z — Redo
      if ((isMod && e.key === 'y') || (isMod && e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        undoRedo.redo();
        return;
      }
      // Ctrl+C — Copy
      if (isMod && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      // Ctrl+V — Paste
      if (isMod && e.key === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }
      // Delete / Backspace — Delete selected with confirmation
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        if (multiSelect.count > 0) {
          e.preventDefault();
          handleDeleteSelected();
        } else if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
        return;
      }
      // Escape — exit connect mode or clear selection
      if (e.key === 'Escape') {
        if (connectMode) {
          setConnectMode(false);
          setConnectSource(null);
        } else {
          setSelectedNodeId(null);
          multiSelect.clearSelection();
        }
        return;
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedNodeId, connectMode, multiSelect,
    undoRedo, handleCopy, handlePaste, handleDeleteNode, handleDeleteSelected,
  ]);

  // ---- Click on canvas background to deselect ----
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setSelectedNodeId(null);
        multiSelect.clearSelection();
        if (connectMode) {
          setConnectMode(false);
          setConnectSource(null);
        }
      }
    },
    [connectMode, multiSelect],
  );

  // ---- Render ----
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={cn('flex flex-col h-full w-full border rounded-lg overflow-hidden bg-background', className)}
    >
      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={confirmDialog.onCancel}
        destructive
      />

      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-2 p-2 border-b bg-muted/20" role="toolbar" aria-label="Process toolbar">
          <GitBranch className="h-4 w-4" />
          <span className="font-medium text-sm" aria-label="Process name">{processName}</span>
          {version && (
            <span
              className="rounded border px-1.5 text-[10px] tabular-nums text-muted-foreground"
              aria-label="Process version"
              data-testid="process-version"
            >
              {versionLabel(version)}
            </span>
          )}

          {/* Collaboration indicator */}
          {collaboration?.isConnected && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground" role="status" aria-label="Collaboration active">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {collaboration.users.length} user{collaboration.users.length !== 1 ? 's' : ''}
            </div>
          )}

          <div className="flex-1" />

          {!readOnly && (
            <div className="flex items-center gap-1">
              {/* Undo / Redo */}
              <button type="button"
                onClick={() => undoRedo.undo()}
                disabled={!undoRedo.canUndo}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-40"
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                <Undo2 className="h-3 w-3" />
              </button>
              <button type="button"
                onClick={() => undoRedo.redo()}
                disabled={!undoRedo.canRedo}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-40"
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
              >
                <Redo2 className="h-3 w-3" />
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Copy / Paste */}
              <button type="button"
                onClick={handleCopy}
                disabled={multiSelect.count === 0 && !selectedNodeId}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-40"
                title="Copy (Ctrl+C)"
                aria-label="Copy"
              >
                <Copy className="h-3 w-3" />
              </button>
              <button type="button"
                onClick={handlePaste}
                disabled={!clipboard.hasContent}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-40"
                title="Paste (Ctrl+V)"
                aria-label="Paste"
              >
                <Clipboard className="h-3 w-3" />
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Connect mode */}
              <button type="button"
                onClick={handleToggleConnectMode}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent',
                  connectMode && 'bg-primary text-primary-foreground',
                )}
                title="Connect nodes"
                aria-label="Connect nodes"
                aria-pressed={connectMode}
              >
                <Link className="h-3 w-3" /> Connect
              </button>

              {/* Auto-layout */}
              <button type="button"
                onClick={handleAutoLayout}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Auto layout"
                aria-label="Auto layout"
              >
                <Layout className="h-3 w-3" /> Layout
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Zoom controls */}
              <button type="button"
                onClick={panZoom.zoomIn}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <span className="text-xs tabular-nums min-w-[3ch] text-center" aria-label="Zoom level">
                {Math.round(panZoom.zoom * 100)}%
              </span>
              <button type="button"
                onClick={panZoom.zoomOut}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button type="button"
                onClick={panZoom.resetZoom}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <RotateCcw className="h-3 w-3" />
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Add node buttons */}
              <button type="button"
                onClick={() => handleAddNode('start-event', 'Start')}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Add Start Event"
                aria-label="Add Start Event"
              >
                <Play className="h-3 w-3 text-green-600" /> Start
              </button>
              <button type="button"
                onClick={() => handleAddNode('user-task', 'User Task')}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Add User Task"
                aria-label="Add User Task"
              >
                <Square className="h-3 w-3 text-blue-600" /> Task
              </button>
              <button type="button"
                onClick={() => handleAddNode('exclusive-gateway', 'Decision')}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Add Gateway"
                aria-label="Add Gateway"
              >
                <Diamond className="h-3 w-3 text-yellow-600" /> Gateway
              </button>
              <button type="button"
                onClick={() => handleAddNode('end-event', 'End')}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title="Add End Event"
                aria-label="Add End Event"
              >
                <Square className="h-3 w-3 text-red-600" /> End
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Toggle property panel */}
              <button type="button"
                onClick={() => setShowPropertyPanel((p) => !p)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent"
                title={showPropertyPanel ? 'Hide properties' : 'Show properties'}
                aria-label={showPropertyPanel ? 'Hide property panel' : 'Show property panel'}
                aria-expanded={showPropertyPanel}
              >
                {showPropertyPanel ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main content area: canvas + property panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div
          className="flex-1 overflow-auto bg-muted/10 p-4"
          role="region"
          aria-label="Process canvas"
          onWheel={panZoom.handleWheel}
          onMouseDown={panZoom.startPan}
        >
          <div
            className={cn('relative', canvas.backgroundColor && CANVAS_BACKGROUND_CLASS)}
            data-testid="process-canvas"
            style={{
              ...canvasBackgroundStyle(canvas.backgroundColor),
              ...panZoom.transformStyle,
              width: canvas.width,
              minHeight: canvas.height,
              backgroundImage: canvas.showGrid
                ? 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)'
                : undefined,
              backgroundSize: canvas.showGrid ? '20px 20px' : undefined,
            }}
            onClick={handleCanvasClick}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          >
            {/* Edge SVG layer */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={canvas.width}
              height={canvas.height}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="hsl(var(--foreground))" />
                </marker>
              </defs>
              {/* Swim lanes, under the flows and the nodes */}
              {bands.map(({ lane, top, height, members }) => (
                <g key={lane.id} data-testid={`process-lane-${lane.id}`}>
                  <title>
                    {`${lane.label}${lane.role ? ` (${lane.role})` : ''} · ${members} node${members === 1 ? '' : 's'}`}
                  </title>
                  <rect
                    x={0}
                    y={top}
                    width={canvas.width}
                    height={height}
                    className="fill-muted/40 stroke-border"
                    strokeDasharray="4,4"
                  />
                  <text x={8} y={top + 14} className="text-[10px] font-medium fill-muted-foreground">
                    {lane.label}
                    {lane.role && (
                      <tspan className="font-normal" data-testid={`process-lane-role-${lane.id}`}>
                        {` · ${lane.role}`}
                      </tspan>
                    )}
                  </text>
                </g>
              ))}
              {edges.map((edge) => {
                const source = nodes.find((n) => n.id === edge.source);
                const target = nodes.find((n) => n.id === edge.target);
                if (!source || !target) return null;

                const sx = source.position.x + NODE_WIDTH / 2;
                const sy = source.position.y + NODE_HEIGHT / 2;
                const tx = target.position.x + NODE_WIDTH / 2;
                const ty = target.position.y + NODE_HEIGHT / 2;

                // Exit from right side of source, enter left side of target
                const x1 = source.position.x + NODE_WIDTH;
                const y1 = sy;
                const x2 = target.position.x;
                const y2 = ty;

                // Quadratic Bezier control point at midpoint-x
                const cx = (x1 + x2) / 2;
                const d = `M ${x1} ${y1} Q ${cx} ${y1}, ${(x1 + x2) / 2} ${(y1 + y2) / 2} T ${x2} ${y2}`;

                return (
                  <g key={edge.id} data-testid={`process-edge-${edge.id}`}>
                    {(edge.isDefault || edge.condition) && (
                      <title>
                        {[edge.isDefault ? 'Default flow' : '', edge.condition ? `Condition: ${edge.condition}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </title>
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke="hsl(var(--foreground) / 0.5)"
                      strokeWidth="2"
                      markerEnd="url(#arrowhead)"
                    />
                    {/* BPMN's default-flow marker: a slash across the flow near its source */}
                    {edge.isDefault && (
                      <line
                        x1={x1 + 8}
                        y1={y1 + 6}
                        x2={x1 + 16}
                        y2={y1 - 6}
                        stroke="hsl(var(--foreground) / 0.5)"
                        strokeWidth="2"
                        data-testid={`process-edge-default-${edge.id}`}
                      />
                    )}
                    {edge.label && (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 8}
                        textAnchor="middle"
                        className="text-[10px] fill-muted-foreground"
                      >
                        {edge.label}
                      </text>
                    )}
                    {edge.condition && (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 + 14}
                        textAnchor="middle"
                        className="text-[10px] font-mono fill-muted-foreground"
                        data-testid={`process-edge-condition-${edge.id}`}
                      >
                        [{edge.condition}]
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground text-sm">
                No nodes in the process. Use the toolbar buttons to add start events, tasks, gateways, and end events.
              </div>
            )}

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = multiSelect.isSelected(node.id) || selectedNodeId === node.id;
              const isConnectSource = connectSource === node.id;
              const isHovered = hoveredNodeId === node.id;
              const showPorts = connectMode || isHovered;

              return (
                <div
                  key={node.id}
                  className="absolute select-none"
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                  }}
                  role="group"
                  aria-label={node.label}
                  draggable={!readOnly && !connectMode}
                  onDragStart={(e) => handleDragStart(e, node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(e) => {
                    // Edge creation takes priority
                    if (handleNodeClickForConnect(node.id)) return;
                    // Multi-select with shift key
                    if (e.shiftKey) {
                      multiSelect.toggle(node.id, true);
                    } else {
                      setSelectedNodeId(node.id);
                      multiSelect.selectOne(node.id);
                    }
                  }}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center border-2 min-w-[120px] min-h-[50px] px-3 py-2 transition-shadow',
                      getNodeStyle(node.type),
                      isSelected && 'ring-2 ring-primary shadow-md',
                      isConnectSource && 'ring-2 ring-blue-400 shadow-lg',
                      connectMode && !isConnectSource && 'cursor-crosshair',
                    )}
                  >
                    <span className={cn(
                      'text-xs font-medium',
                      (node.type === 'exclusive-gateway' || node.type === 'parallel-gateway'
                        || node.type === 'inclusive-gateway' || node.type === 'event-based-gateway') && '-rotate-45',
                    )}>
                      {node.label}
                    </span>
                  </div>

                  {/* Connection ports — shown when hovering or in connect mode */}
                  {showPorts && !readOnly && (
                    <>
                      {/* Left port (input) */}
                      <div
                        className="absolute w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow cursor-crosshair"
                        style={{ left: -6, top: NODE_HEIGHT / 2 - 6 }}
                        title="Input port"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNodeClickForConnect(node.id);
                        }}
                      />
                      {/* Right port (output) */}
                      <div
                        className="absolute w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow cursor-crosshair"
                        style={{ right: -6, top: NODE_HEIGHT / 2 - 6 }}
                        title="Output port"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!connectMode) {
                            setConnectMode(true);
                            setConnectSource(node.id);
                          } else {
                            handleNodeClickForConnect(node.id);
                          }
                        }}
                      />
                      {/* Top port */}
                      <div
                        className="absolute w-3 h-3 rounded-full bg-blue-400 border-2 border-white shadow cursor-crosshair"
                        style={{ left: NODE_WIDTH / 2 - 6, top: -6 }}
                        title="Port"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNodeClickForConnect(node.id);
                        }}
                      />
                      {/* Bottom port */}
                      <div
                        className="absolute w-3 h-3 rounded-full bg-blue-400 border-2 border-white shadow cursor-crosshair"
                        style={{ left: NODE_WIDTH / 2 - 6, bottom: -6 }}
                        title="Port"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNodeClickForConnect(node.id);
                        }}
                      />
                    </>
                  )}

                  {/* Delete button */}
                  {!readOnly && isSelected && !connectMode && (
                    <button type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNode(node.id);
                      }}
                      className="absolute -top-2 -right-2 p-0.5 rounded-full bg-destructive text-destructive-foreground shadow"
                      aria-label="Delete node"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Minimap */}
            {showMinimapProp && nodes.length > 0 && (
              <Minimap
                items={minimapItems}
                canvasWidth={canvas.width ?? 1400}
                canvasHeight={canvas.height ?? 800}
                position="bottom-right"
              />
            )}
          </div>
        </div>

        {/* Collapsible property panel */}
        {showPropertyPanel && !readOnly && (
          <div className="w-64 border-l bg-background overflow-y-auto shrink-0" role="complementary" aria-label="Property panel">
            <PropertyEditor
              title={selectedNode ? `Properties: ${selectedNode.label}` : 'Properties'}
              fields={propertyFields}
              onChange={handlePropertyChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

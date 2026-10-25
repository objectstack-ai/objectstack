/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  DesignerComponent,
  DesignerCanvasConfig,
  DesignerPaletteCategory,
  DesignerPaletteItem,
} from '@object-ui/types';
import {
  GripVertical,
  Undo2,
  Redo2,
  Eye,
  Layers,
  Plus,
  Minus,
  Maximize2,
  Trash2,
  Copy,
  Clipboard,
  PanelLeftClose,
  PanelRightClose,
  Map,
  Lock,
  EyeOff,
} from 'lucide-react';
import { resolveIcon } from '@object-ui/components';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useMultiSelect } from './hooks/useMultiSelect';
import { useClipboard } from './hooks/useClipboard';
import { useCanvasPanZoom } from './hooks/useCanvasPanZoom';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PropertyEditor, type PropertyField } from './components/PropertyEditor';
import { Minimap, type MinimapItem } from './components/Minimap';
import { useCollaboration } from './CollaborationProvider';
import { CANVAS_BACKGROUND_CLASS, canvasBackgroundStyle } from './canvasBackground';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

/*
 * The component TREE (objectui#11434). `DesignerComponent.children` nests a
 * component inside its parent, so every lookup and every edit below walks the
 * whole tree rather than the top level alone.
 */

/** Every component of the tree, depth first, with its nesting depth. */
function flattenTree(list: DesignerComponent[], depth = 0): { comp: DesignerComponent; depth: number }[] {
  return list.flatMap((comp) => [{ comp, depth }, ...flattenTree(comp.children ?? [], depth + 1)]);
}

/** The tree with `fn` applied to every component, at every depth. */
function mapTree(list: DesignerComponent[], fn: (comp: DesignerComponent) => DesignerComponent): DesignerComponent[] {
  return list.map((comp) => {
    const next = fn(comp);
    return next.children ? { ...next, children: mapTree(next.children, fn) } : next;
  });
}

/**
 * Whether deleting this component would remove a locked one — itself, or any
 * component nested in it. A lock is never removed by a delete
 * (objectui#11434), so such a component is kept, parent included.
 */
function holdsLock(comp: DesignerComponent): boolean {
  return comp.locked === true || (comp.children ?? []).some(holdsLock);
}

/** The tree without the components `keep` rejects, at every depth (a removed parent takes its children). */
function filterTree(list: DesignerComponent[], keep: (comp: DesignerComponent) => boolean): DesignerComponent[] {
  return list
    .filter(keep)
    .map((comp) => (comp.children ? { ...comp, children: filterTree(comp.children, keep) } : comp));
}

export interface PageDesignerProps {
  /** Canvas configuration */
  canvas?: DesignerCanvasConfig;
  /** Initial components */
  components?: DesignerComponent[];
  /** Component palette categories */
  palette?: DesignerPaletteCategory[];
  /** Show component tree panel */
  showComponentTree?: boolean;
  /** Enable undo/redo */
  undoRedo?: boolean;
  /** Property editor */
  propertyEditor?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Show minimap */
  showMinimap?: boolean;
  /** Callback when components change */
  onChange?: (components: DesignerComponent[]) => void;
  /** Custom CSS class */
  className?: string;
}

/**
 * Drag-and-drop page designer component.
 * Allows visual composition of UI components on a canvas. The canvas draws its
 * declared `backgroundColor`; a component draws its `children` inside it, is
 * held in place when `locked`, drawn faded when not `visible`, and stacked by
 * `zIndex`; the palette draws each category's and item's `icon` and an item's
 * `preview` (objectui#11434).
 */
export function PageDesigner({
  canvas = { width: 1200, height: 800, gridSize: 8, showGrid: true, snapToGrid: true },
  components: initialComponents = [],
  palette = DEFAULT_PALETTE,
  showComponentTree = true,
  undoRedo: undoRedoEnabled = true,
  propertyEditor: propertyEditorEnabled = true,
  readOnly = false,
  showMinimap: showMinimapProp = false,
  onChange,
  className,
}: PageDesignerProps) {
  // -- Undo / Redo ----------------------------------------------------------
  const history = useUndoRedo<DesignerComponent[]>(initialComponents);
  const components = history.current;

  const pushComponents = useCallback(
    (next: DesignerComponent[]) => {
      history.push(next);
      onChange?.(next);
    },
    [history, onChange],
  );

  // -- Pan / Zoom (replaces manual zoom state) ------------------------------
  const panZoom = useCanvasPanZoom({
    initialZoom: canvas.zoom ?? 1,
  });
  const { zoom } = panZoom;

  // -- Multi-select ---------------------------------------------------------
  const multiSelect = useMultiSelect();

  // Convenience: first selected id (for property editor / single-select compat)
  const selectedId = useMemo(() => {
    const ids = Array.from(multiSelect.selectedIds);
    return ids.length > 0 ? ids[0] : null;
  }, [multiSelect.selectedIds]);

  const selectedComponent = useMemo(
    () => flattenTree(components).find((entry) => entry.comp.id === selectedId)?.comp,
    [components, selectedId],
  );

  // -- Clipboard ------------------------------------------------------------
  const clipboard = useClipboard<DesignerComponent[]>();

  // -- Confirm dialog -------------------------------------------------------
  const confirmDialog = useConfirmDialog();

  // -- Collaboration (optional) ---------------------------------------------
  const collaboration = useCollaboration();

  const broadcastOp = useCallback(
    (op: { type: 'insert' | 'update' | 'delete' | 'move' | 'resize'; elementId: string; data: Record<string, unknown> }) => {
      if (!collaboration) return;
      collaboration.sendOperation({ ...op, userId: collaboration.currentUserId ?? '' });
    },
    [collaboration],
  );

  // -- Collapsible panels ---------------------------------------------------
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [minimapVisible, setMinimapVisible] = useState(showMinimapProp);

  // -- Drag-and-drop state --------------------------------------------------
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // -- Helpers --------------------------------------------------------------
  const snapToGrid = useCallback(
    (value: number) => {
      if (!canvas.snapToGrid || !canvas.gridSize) return value;
      return Math.round(value / canvas.gridSize) * canvas.gridSize;
    },
    [canvas.snapToGrid, canvas.gridSize],
  );

  // -- Component mutations --------------------------------------------------
  const handleAddComponent = useCallback(
    (type: string, label: string) => {
      if (readOnly) return;
      const paletteItem = palette
        .flatMap((c) => c.items)
        .find((i) => i.type === type);
      const defaultSize = paletteItem?.defaultSize;
      const newComponent: DesignerComponent = {
        id: `comp-${Date.now()}`,
        type,
        label,
        position: {
          x: 100,
          y: 100,
          width: defaultSize?.width ?? 200,
          height: defaultSize?.height ?? 100,
        },
        props: paletteItem?.defaultProps ?? {},
      };
      const updated = [...components, newComponent];
      pushComponents(updated);
      multiSelect.selectOne(newComponent.id);
      broadcastOp({ type: 'insert', elementId: newComponent.id, data: { component: newComponent } });
    },
    [components, readOnly, palette, pushComponents, multiSelect, broadcastOp],
  );

  const handleDeleteComponent = useCallback(
    (id: string) => {
      if (readOnly) return;
      const target = flattenTree(components).find((entry) => entry.comp.id === id)?.comp;
      if (!target || holdsLock(target)) return;
      const updated = filterTree(components, (c) => c.id !== id);
      pushComponents(updated);
      if (multiSelect.isSelected(id)) multiSelect.clearSelection();
      broadcastOp({ type: 'delete', elementId: id, data: {} });
    },
    [components, readOnly, pushComponents, multiSelect, broadcastOp],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (readOnly || multiSelect.count === 0) return;
    // A locked component, and a parent that holds one, is not deleted
    // (objectui#11434): only the rest of the selection is.
    const ids = new Set(
      flattenTree(components)
        .map((entry) => entry.comp)
        .filter((c) => multiSelect.selectedIds.has(c.id) && !holdsLock(c))
        .map((c) => c.id),
    );
    if (ids.size === 0) return;
    const confirmed = await confirmDialog.confirm(
      'Delete components',
      `Are you sure you want to delete ${ids.size} component${ids.size > 1 ? 's' : ''}?`,
    );
    if (!confirmed) return;
    const updated = filterTree(components, (c) => !ids.has(c.id));
    pushComponents(updated);
    multiSelect.clearSelection();
    ids.forEach((id) => {
      broadcastOp({ type: 'delete', elementId: id, data: {} });
    });
  }, [readOnly, multiSelect, confirmDialog, components, pushComponents, broadcastOp]);

  const handleUpdateProperty = useCallback(
    (name: string, value: unknown) => {
      if (readOnly || !selectedId) return;
      const updated = mapTree(components, (c) => {
        if (c.id !== selectedId) return c;
        if (name === 'label') return { ...c, label: String(value) };
        if (name === 'locked' || name === 'visible') return { ...c, [name]: Boolean(value) };
        if (name === 'zIndex') return { ...c, zIndex: Number(value) };
        if (name === 'x') return { ...c, position: { ...c.position, x: Number(value) } };
        if (name === 'y') return { ...c, position: { ...c.position, y: Number(value) } };
        if (name === 'width') return { ...c, position: { ...c.position, width: Number(value) } };
        if (name === 'height') return { ...c, position: { ...c.position, height: Number(value) } };
        return { ...c, props: { ...c.props, [name]: value } };
      });
      pushComponents(updated);
      broadcastOp({ type: 'update', elementId: selectedId, data: { [name]: value } });
    },
    [readOnly, selectedId, components, pushComponents, broadcastOp],
  );

  // -- Copy / Paste ---------------------------------------------------------
  const handleCopy = useCallback(() => {
    const ids = multiSelect.selectedIds;
    if (ids.size === 0) return;
    const selected = flattenTree(components)
      .map((entry) => entry.comp)
      .filter((c) => ids.has(c.id));
    clipboard.copy(selected);
  }, [multiSelect, components, clipboard]);

  const handlePaste = useCallback(() => {
    if (readOnly) return;
    const items = clipboard.paste();
    if (!items || items.length === 0) return;
    let pasteCounter = 0;
    const pasted = items.map((c) => ({
      ...c,
      id: `comp-${Date.now()}-${++pasteCounter}-${Math.random().toString(36).slice(2, 7)}`,
      position: { ...c.position, x: c.position.x + 20, y: c.position.y + 20 },
    }));
    const updated = [...components, ...pasted];
    pushComponents(updated);
    multiSelect.selectMany(pasted.map((p) => p.id));
    pasted.forEach((p) => {
      broadcastOp({ type: 'insert', elementId: p.id, data: { component: p } });
    });
  }, [readOnly, clipboard, components, pushComponents, multiSelect, broadcastOp]);

  // -- Drag-and-drop handlers -----------------------------------------------
  const handleDragStart = useCallback(
    (e: React.DragEvent, comp: DesignerComponent) => {
      if (readOnly) return;
      dragRef.current = { id: comp.id, startX: e.clientX, startY: e.clientY };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', comp.id);
    },
    [readOnly],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const drag = dragRef.current;
      if (!drag || readOnly) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const updated = mapTree(components, (c) => {
        if (c.id !== drag.id) return c;
        return {
          ...c,
          position: {
            ...c.position,
            x: snapToGrid(c.position.x + dx),
            y: snapToGrid(c.position.y + dy),
          },
        };
      });
      pushComponents(updated);
      broadcastOp({ type: 'move', elementId: drag.id, data: {} });
      dragRef.current = null;
    },
    [readOnly, zoom, components, pushComponents, snapToGrid, broadcastOp],
  );

  // -- Property fields for PropertyEditor -----------------------------------
  const propertyFields = useMemo<PropertyField[]>(() => {
    if (!selectedComponent) return [];
    return [
      { name: 'label', label: 'Label', type: 'text' as const, value: selectedComponent.label ?? '', group: 'General' },
      { name: 'x', label: 'X', type: 'number' as const, value: selectedComponent.position.x, group: 'Position' },
      { name: 'y', label: 'Y', type: 'number' as const, value: selectedComponent.position.y, group: 'Position' },
      { name: 'width', label: 'Width', type: 'number' as const, value: selectedComponent.position.width, group: 'Size' },
      { name: 'height', label: 'Height', type: 'number' as const, value: selectedComponent.position.height, group: 'Size' },
      { name: 'visible', label: 'Visible', type: 'boolean' as const, value: selectedComponent.visible !== false, group: 'Layer' },
      { name: 'locked', label: 'Locked', type: 'boolean' as const, value: selectedComponent.locked === true, group: 'Layer' },
      { name: 'zIndex', label: 'Z-index', type: 'number' as const, value: selectedComponent.zIndex ?? 0, group: 'Layer' },
    ];
  }, [selectedComponent]);

  // -- Minimap items --------------------------------------------------------
  const minimapItems = useMemo<MinimapItem[]>(
    () =>
      components.map((c) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
        width: typeof c.position.width === 'number' ? c.position.width : 100,
        height: typeof c.position.height === 'number' ? c.position.height : 50,
        selected: multiSelect.isSelected(c.id),
      })),
    [components, multiSelect],
  );

  // -- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      const ctrl = e.ctrlKey || e.metaKey;

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && multiSelect.count > 0 && !isInput) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }
      // Escape
      if (e.key === 'Escape') {
        multiSelect.clearSelection();
        return;
      }
      if (isInput) return;
      // Ctrl+Z – Undo
      if (ctrl && e.key === 'z' && !e.shiftKey && undoRedoEnabled && !readOnly) {
        e.preventDefault();
        history.undo();
        return;
      }
      // Ctrl+Shift+Z / Ctrl+Y – Redo
      if (ctrl && ((e.key === 'z' && e.shiftKey) || e.key === 'y') && undoRedoEnabled && !readOnly) {
        e.preventDefault();
        history.redo();
        return;
      }
      // Ctrl+C – Copy
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      // Ctrl+V – Paste
      if (ctrl && e.key === 'v' && !readOnly) {
        e.preventDefault();
        handlePaste();
        return;
      }
      // Ctrl+A – Select all
      if (ctrl && e.key === 'a') {
        e.preventDefault();
        multiSelect.selectMany(components.map((c) => c.id));
        return;
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [
    multiSelect,
    handleDeleteSelected,
    undoRedoEnabled,
    readOnly,
    history,
    handleCopy,
    handlePaste,
    components,
  ]);

  // -- One component on the canvas, and its children inside it -------------
  // `locked` holds it in place (no drag, no canvas delete), `visible: false`
  // draws it faded with a dashed edge so it can still be found and selected,
  // and `zIndex` orders overlapping siblings (objectui#11434).
  const renderComponent = (comp: DesignerComponent): React.ReactNode => {
    const isSelected = multiSelect.isSelected(comp.id);
    const hidden = comp.visible === false;
    return (
      <div
        key={comp.id}
        draggable={!readOnly && !comp.locked}
        onDragStart={(e) => {
          e.stopPropagation();
          handleDragStart(e, comp);
        }}
        className={cn(
          'absolute border rounded select-none transition-shadow',
          comp.locked ? 'cursor-default' : 'cursor-move',
          isSelected
            ? 'border-primary ring-2 ring-primary/20 shadow-md'
            : 'border-border hover:border-primary/50',
          hidden && 'opacity-40 border-dashed',
        )}
        style={{
          left: comp.position.x * zoom,
          top: comp.position.y * zoom,
          width:
            typeof comp.position.width === 'number'
              ? comp.position.width * zoom
              : comp.position.width,
          height:
            typeof comp.position.height === 'number'
              ? comp.position.height * zoom
              : comp.position.height,
          zIndex: comp.zIndex,
        }}
        data-testid={`page-component-${comp.id}`}
        onClick={(e) => {
          e.stopPropagation();
          multiSelect.toggle(comp.id, e.shiftKey);
        }}
      >
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 text-xs border-b">
          <GripVertical className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{comp.label ?? comp.type}</span>
          {hidden && <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Hidden" />}
          {comp.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Locked" />}
          {!readOnly && !holdsLock(comp) && (
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteComponent(comp.id);
              }}
              className="ml-auto p-0.5 rounded hover:bg-destructive/10"
              aria-label={`Delete ${comp.label ?? comp.type}`}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </button>
          )}
        </div>
        <div className="relative p-2 text-xs text-muted-foreground">
          {comp.type}
          {comp.children?.map((child) => renderComponent(child))}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={cn(
        'flex h-full w-full border rounded-lg overflow-hidden bg-background',
        className,
      )}
    >
      {/* Left Panel - Component Palette */}
      {!readOnly && (
        <div
          className={cn(
            'border-r bg-muted/30 flex flex-col transition-[width] duration-200',
            leftPanelOpen ? 'w-60' : 'w-0 overflow-hidden',
          )}
          role="region"
          aria-label="Component palette"
        >
          {leftPanelOpen && (
            <>
              <div className="p-3 border-b font-medium text-sm">Components</div>
              <div className="flex-1 overflow-y-auto p-2">
                {palette.map((category) => {
                  const CategoryIcon = resolveIcon(category.icon);
                  return (
                    <div key={category.name} className="mb-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-2 py-1 uppercase">
                        {CategoryIcon && (
                          <CategoryIcon className="h-3 w-3" aria-hidden="true" data-testid={`palette-category-icon-${category.name}`} />
                        )}
                        {category.label}
                      </div>
                      {category.items.map((item: DesignerPaletteItem) => {
                        // The declared icon when it names a Lucide glyph; the
                        // generic "add" glyph otherwise, as before.
                        const ItemIcon = resolveIcon(item.icon) ?? Plus;
                        return (
                          <button type="button"
                            key={item.type}
                            onClick={() => handleAddComponent(item.type, item.label)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
                            data-testid={`palette-item-${item.type}`}
                          >
                            <ItemIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.label}</span>
                            {item.preview && (
                              <img
                                src={item.preview}
                                alt=""
                                loading="lazy"
                                className="ml-auto h-6 w-10 shrink-0 rounded border object-cover"
                                data-testid={`palette-item-preview-${item.type}`}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Center - Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div
          className="flex items-center gap-2 p-2 border-b bg-muted/20"
          role="toolbar"
          aria-label="Designer toolbar"
        >
          {/* Left panel toggle */}
          {!readOnly && (
            <button type="button"
              className="p-1.5 rounded hover:bg-accent"
              title={leftPanelOpen ? 'Collapse palette' : 'Expand palette'}
              aria-label={leftPanelOpen ? 'Collapse palette' : 'Expand palette'}
              onClick={() => setLeftPanelOpen((v) => !v)}
            >
              <PanelLeftClose className={cn('h-4 w-4', !leftPanelOpen && 'rotate-180')} />
            </button>
          )}

          {/* Undo / Redo */}
          {undoRedoEnabled && !readOnly && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <button type="button"
                className={cn('p-1.5 rounded hover:bg-accent', !history.canUndo && 'opacity-40 pointer-events-none')}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                disabled={!history.canUndo}
                onClick={() => history.undo()}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button"
                className={cn('p-1.5 rounded hover:bg-accent', !history.canRedo && 'opacity-40 pointer-events-none')}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                disabled={!history.canRedo}
                onClick={() => history.redo()}
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-border mx-1" />
            </>
          )}

          {/* Copy / Paste */}
          {!readOnly && (
            <>
              <button type="button"
                className={cn('p-1.5 rounded hover:bg-accent', multiSelect.count === 0 && 'opacity-40 pointer-events-none')}
                title="Copy (Ctrl+C)"
                aria-label="Copy"
                disabled={multiSelect.count === 0}
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4" />
              </button>
              <button type="button"
                className={cn('p-1.5 rounded hover:bg-accent', !clipboard.hasContent && 'opacity-40 pointer-events-none')}
                title="Paste (Ctrl+V)"
                aria-label="Paste"
                disabled={!clipboard.hasContent}
                onClick={handlePaste}
              >
                <Clipboard className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-border mx-1" />
            </>
          )}

          {/* Delete selected */}
          {!readOnly && (
            <button type="button"
              className={cn('p-1.5 rounded hover:bg-accent', multiSelect.count === 0 && 'opacity-40 pointer-events-none')}
              title="Delete selected"
              aria-label="Delete selected"
              disabled={multiSelect.count === 0}
              onClick={handleDeleteSelected}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          <button type="button" className="p-1.5 rounded hover:bg-accent" title="Preview" aria-label="Preview">
            <Eye className="h-4 w-4" />
          </button>

          {/* Minimap toggle */}
          <button type="button"
            className={cn('p-1.5 rounded hover:bg-accent', minimapVisible && 'bg-accent')}
            title="Toggle minimap"
            aria-label="Toggle minimap"
            onClick={() => setMinimapVisible((v) => !v)}
          >
            <Map className="h-4 w-4" />
          </button>

          <div className="flex-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button type="button"
              className="p-1 rounded hover:bg-accent text-xs"
              aria-label="Zoom out"
              onClick={panZoom.zoomOut}
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-xs text-muted-foreground w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button type="button"
              className="p-1 rounded hover:bg-accent text-xs"
              aria-label="Zoom in"
              onClick={panZoom.zoomIn}
            >
              <Plus className="h-3 w-3" />
            </button>
            <button type="button"
              className="p-1 rounded hover:bg-accent text-xs"
              aria-label="Reset zoom"
              onClick={panZoom.resetZoom}
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>

          {/* Right panel toggle */}
          {showComponentTree && (
            <button type="button"
              className="p-1.5 rounded hover:bg-accent"
              title={rightPanelOpen ? 'Collapse panel' : 'Expand panel'}
              aria-label={rightPanelOpen ? 'Collapse panel' : 'Expand panel'}
              onClick={() => setRightPanelOpen((v) => !v)}
            >
              <PanelRightClose className={cn('h-4 w-4', !rightPanelOpen && 'rotate-180')} />
            </button>
          )}
        </div>

        {/* Canvas Area */}
        <div
          className="flex-1 overflow-auto bg-muted/10 p-4 relative"
          role="region"
          aria-label="Design canvas"
          onWheel={panZoom.handleWheel}
          onMouseDown={panZoom.startPan}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div
            className={cn(
              'relative bg-background border rounded shadow-sm mx-auto',
              canvas.backgroundColor && CANVAS_BACKGROUND_CLASS,
            )}
            data-testid="page-canvas"
            style={{
              ...canvasBackgroundStyle(canvas.backgroundColor),
              width: canvas.width * zoom,
              height: canvas.height * zoom,
              transform: `translate(${panZoom.panOffset.x}px, ${panZoom.panOffset.y}px)`,
              backgroundImage: canvas.showGrid
                ? `radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)`
                : undefined,
              backgroundSize:
                canvas.showGrid && canvas.gridSize
                  ? `${canvas.gridSize * zoom}px ${canvas.gridSize * zoom}px`
                  : undefined,
            }}
          >
            {components.map((comp) => renderComponent(comp))}

            {/* Minimap */}
            {minimapVisible && (
              <Minimap
                items={minimapItems}
                canvasWidth={canvas.width}
                canvasHeight={canvas.height}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Component Tree / Properties */}
      {showComponentTree && (
        <div
          className={cn(
            'border-l bg-muted/30 flex flex-col transition-[width] duration-200',
            rightPanelOpen ? 'w-60' : 'w-0 overflow-hidden',
          )}
          role="region"
          aria-label="Component tree"
        >
          {rightPanelOpen && (
            <>
              <div className="p-3 border-b font-medium text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Component Tree
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {components.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    No components added yet. Click a component in the palette to add it to the
                    canvas.
                  </div>
                ) : (
                  flattenTree(components).map(({ comp, depth }) => (
                    <button type="button"
                      key={comp.id}
                      onClick={(e) => multiSelect.toggle(comp.id, e.shiftKey)}
                      className={cn(
                        'w-full flex items-center gap-2 py-1.5 pr-2 pl-[calc(0.5rem+var(--tree-depth)*0.75rem)] text-sm rounded text-left',
                        multiSelect.isSelected(comp.id) ? 'bg-accent' : 'hover:bg-accent/50',
                        comp.visible === false && 'text-muted-foreground',
                      )}
                      style={{ '--tree-depth': depth } as React.CSSProperties}
                      data-testid={`page-tree-item-${comp.id}`}
                      data-depth={depth}
                    >
                      <span className="truncate">{comp.label ?? comp.type}</span>
                      {comp.visible === false && <EyeOff className="ml-auto h-3 w-3 shrink-0" aria-label="Hidden" />}
                      {comp.locked && (
                        <Lock className={cn('h-3 w-3 shrink-0', comp.visible !== false && 'ml-auto')} aria-label="Locked" />
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Property Editor */}
              {propertyEditorEnabled && selectedComponent ? (
                <div className="border-t">
                  <PropertyEditor
                    title={`Properties – ${selectedComponent.label ?? selectedComponent.type}`}
                    fields={propertyFields}
                    onChange={handleUpdateProperty}
                  />
                </div>
              ) : (
                selectedComponent && (
                  <div className="border-t p-3">
                    <div className="text-xs font-medium mb-2">Properties</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Type: {selectedComponent.type}</div>
                      <div>ID: {selectedComponent.id}</div>
                      <div>
                        Position: {selectedComponent.position.x},{' '}
                        {selectedComponent.position.y}
                      </div>
                      <div>
                        Size: {selectedComponent.position.width} ×{' '}
                        {selectedComponent.position.height}
                      </div>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={confirmDialog.onCancel}
      />
    </div>
  );
}

const DEFAULT_PALETTE: DesignerPaletteCategory[] = [
  {
    name: 'layout',
    label: 'Layout',
    items: [
      { type: 'container', label: 'Container', defaultSize: { width: 400, height: 300 } },
      { type: 'flex', label: 'Flex', defaultSize: { width: 400, height: 200 } },
      { type: 'grid', label: 'Grid', defaultSize: { width: 400, height: 300 } },
      { type: 'card', label: 'Card', defaultSize: { width: 300, height: 200 } },
      { type: 'tabs', label: 'Tabs', defaultSize: { width: 400, height: 300 } },
    ],
  },
  {
    name: 'form',
    label: 'Form',
    items: [
      { type: 'input', label: 'Input', defaultSize: { width: 300, height: 60 } },
      { type: 'textarea', label: 'Textarea', defaultSize: { width: 300, height: 120 } },
      { type: 'select', label: 'Select', defaultSize: { width: 300, height: 60 } },
      { type: 'checkbox', label: 'Checkbox', defaultSize: { width: 200, height: 40 } },
      { type: 'button', label: 'Button', defaultSize: { width: 120, height: 40 } },
    ],
  },
  {
    name: 'data',
    label: 'Data',
    items: [
      { type: 'table', label: 'Table', defaultSize: { width: 600, height: 400 } },
      { type: 'chart', label: 'Chart', defaultSize: { width: 400, height: 300 } },
      { type: 'list', label: 'List', defaultSize: { width: 300, height: 400 } },
      { type: 'statistic', label: 'Statistic', defaultSize: { width: 200, height: 100 } },
    ],
  },
];

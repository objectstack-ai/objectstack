/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ViewTabBar Component
 *
 * A reusable view tab bar with:
 * - Inline "+" Add View button
 * - Right-click context menu (rename, duplicate, delete, set as default, share)
 * - Tabs sized to the strip's width; the rest fold into a "N more" dropdown
 *   (`maxVisibleTabs` is an optional cap on top of the width, objectui#12423)
 * - A view-type icon on non-table tabs only (a grid tab is its label alone)
 * - "Save as View" button when user filters differ from saved state
 * - Double-click to rename view tab inline
 * - Drag-reorder view tabs (Phase 2)
 * - Pin/favorite views (Phase 2)
 * - View type quick-switch palette (Phase 2)
 * - Personal vs. shared views grouping (Phase 2)
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type ComponentType } from 'react';
import {
  cn,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  Input,
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@object-ui/components';
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Star,
  Share2,
  Save,
  Table as TableIcon,
  Pin,
  PinOff,
  Lock,
  Globe,
  GripVertical,
  LayoutGrid,
  Settings2,
  ChevronDown,
  ListOrdered,
  Check,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ViewTabBarConfig } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/react';

function useViewTabLabel() {
  // useObjectTranslation is provider-safe (never throws); no try/catch, which
  // would wrap the hook call and violate rules-of-hooks. The `fallback` still
  // applies below when the key is missing/untranslated.
  const { t } = useObjectTranslation();
  return (key: string, fallback: string, vars?: Record<string, unknown>): string => {
    const v = t(key, vars as any);
    // i18next's `t()` is typed `string | object`; coerce so render sites and
    // aria-labels always receive a string (an object child white-screens React).
    return !v || v === key ? fallback : String(v);
  };
}

/** Visibility group sort order: private → team → organization → public */
const VISIBILITY_ORDER: Record<string, number> = { private: 0, team: 1, organization: 2, public: 3 };

/** Minimum drag distance in pixels to activate reorder (large enough to avoid blocking clicks) */
const DRAG_ACTIVATION_DISTANCE = 8;

/**
 * View types drawn as a table. Their tab carries no type icon: the table is
 * what a list is, so the icon only says something on a board, a calendar, a
 * gallery and the rest (objectui#12423).
 */
const TABULAR_VIEW_TYPES: ReadonlySet<string> = new Set(['grid', 'list']);

/** The `gap-0.5` between two tabs in the strip, in pixels. */
const TAB_GAP_PX = 2;

/**
 * The width the "N more" trigger is assumed to take before it has been drawn
 * once. Measured and remembered after its first draw.
 */
const OVERFLOW_TRIGGER_ESTIMATE_PX = 80;

/**
 * How many tabs fit in `available` pixels (objectui#12423).
 *
 * `widths` are the tabs' drawn widths in strip order, each including the gap
 * that follows it; `activeIndex` is the current view's place in that order
 * (`-1` when it is not among them). Every tab fits ⇒ all of them, and no
 * "N more" trigger is drawn. Otherwise the trigger takes `overflowWidth` and
 * the largest head that fits beside it wins — counting the CURRENT view in
 * place of the head's last tab when the current view sits in the tail, since
 * the strip swaps it in (the active-in-tail swap). Never fewer than one.
 */
export function fitVisibleTabCount(
  widths: readonly number[],
  available: number,
  overflowWidth: number,
  activeIndex: number,
): number {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total <= available) return widths.length;
  for (let count = widths.length - 1; count > 1; count--) {
    let used = 0;
    for (let i = 0; i < count; i++) used += widths[i];
    if (activeIndex >= count) used += widths[activeIndex] - widths[count - 1];
    if (used + overflowWidth <= available) return count;
  }
  return 1;
}

/** Width of an element as laid out, `0` where there is no layout. */
function layoutWidth(el: Element | null | undefined): number {
  if (!el) return 0;
  const w = el.getBoundingClientRect().width;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** A single view definition for the tab bar */
export interface ViewTabItem {
  /** Unique view identifier */
  id: string;
  /** Display label */
  label: string;
  /** View type (grid, kanban, calendar, etc.) */
  type: string;
  /**
   * Whether this view has active filters. Kept so a host may pass it; the
   * strip draws nothing for it since objectui#12423 — the toolbar's Filter
   * count says it once the view is open.
   */
  hasActiveFilters?: boolean;
  /** Whether this view has active sort. Drawn nothing for, like `hasActiveFilters`. */
  hasActiveSort?: boolean;
  /** Whether this is the default view */
  isDefault?: boolean;
  /** Whether this view is pinned/favorited */
  isPinned?: boolean;
  /** View visibility for grouping */
  visibility?: 'private' | 'team' | 'organization' | 'public';
  /**
   * Whether this view is *read-only* (e.g. a System View loaded from
   * code/metadata, or a view the current user lacks permission to mutate).
   *
   * When `true`, mutation menu items (Edit configuration, Rename, Set as
   * default, Pin, Change view type, Delete) are hidden from the tab's
   * dropdown / context menu, the inline-rename trigger is disabled, and a
   * lock icon is rendered next to the label. *Duplicate* remains available
   * because it produces a fresh override and does not mutate the source.
   */
  readonly?: boolean;
  /** Optional tooltip shown alongside the lock icon when `readonly` is true. */
  readonlyReason?: string;
  /**
   * The view's description, already resolved to the viewer's language and
   * already gated by the host on the view's `appearance.showDescription`
   * (absent when that is `false`). The strip draws it on the ACTIVE tab only:
   * as the view button's tooltip and as the header of its ▾ actions menu
   * (objectui#12528). It used to take a row of its own above the list's
   * toolbar, so the chrome's height changed with the view.
   */
  description?: string;
}

/** Available view type for quick-switch palette */
export interface AvailableViewType {
  type: string;
  label: string;
  description?: string;
}

export interface ViewTabBarProps {
  /** Views to render as tabs */
  views: ViewTabItem[];
  /** Currently active view ID */
  activeViewId: string;
  /** Callback when a view tab is clicked */
  onViewChange: (viewId: string) => void;
  /** Icon map: view type → React component */
  viewTypeIcons?: Record<string, ComponentType<{ className?: string }>>;
  /** Configuration for the tab bar UX */
  config?: ViewTabBarConfig;

  // --- Action callbacks ---
  /** Called when "+" button is clicked to add a new view */
  onAddView?: () => void;
  /** Called when a view is renamed via context menu or double-click */
  onRenameView?: (viewId: string, newName: string) => void;
  /**
   * Called when a view is duplicated. **Opt-in**: the Duplicate menu item
   * renders only when a host wires this. It is a deliberate generic affordance
   * of this reusable tab bar (duplicate = a fresh override, even for read-only
   * views) — not dead code. The console currently does not wire it (runtime
   * view duplication is deferred to the per-user personalisation work,
   * objectui#1520); omit the prop to hide the affordance.
   */
  onDuplicateView?: (viewId: string) => void;
  /** Called when a view is deleted */
  onDeleteView?: (viewId: string) => void;
  /** Called when a view is set as default */
  onSetDefaultView?: (viewId: string) => void;
  /** Called when a view is shared */
  onShareView?: (viewId: string) => void;
  /** Called when "Save as View" is clicked */
  onSaveAsView?: () => void;
  /** Called when a view is pinned/unpinned */
  onPinView?: (viewId: string, pinned: boolean) => void;
  /** Called when views are reordered via drag */
  onReorderViews?: (viewIds: string[]) => void;
  /** Called when a view type is changed via quick-switch */
  onChangeViewType?: (viewId: string, newType: string) => void;
  /** Called when user clicks the gear icon to configure a view */
  onConfigView?: (viewId: string) => void;
  /** Called when user opens the "Manage views" dialog */
  onManageViews?: () => void;

  /** Available view types for quick-switch palette */
  availableViewTypes?: AvailableViewType[];
  /** Whether user has unsaved filter/sort changes (shows "Save as View" indicator) */
  hasUnsavedChanges?: boolean;
  /** Called when user clicks "Reset" to discard changes */
  onResetChanges?: () => void;
  /** Additional CSS class */
  className?: string;
}

// --- Sortable Tab wrapper ---
const SortableTab: React.FC<{
  id: string;
  disabled?: boolean;
  children: (props: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    listeners: DraggableSyntheticListeners;
    attributes: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
}> = ({ id, disabled, children }) => {
  // `role: 'button'`: these attributes land on the view's own `<button>`
  // (objectui#11690), which a `tab` role would contradict.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled, attributes: { role: 'button', roleDescription: 'view tab', tabIndex: 0 } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return <>{children({ setNodeRef, style, listeners, attributes: attributes as unknown as Record<string, unknown>, isDragging })}</>;
};

/**
 * ViewTabBar — Airtable/Salesforce-style view tab bar with management UX.
 */
export const ViewTabBar: React.FC<ViewTabBarProps> = ({
  views,
  activeViewId,
  onViewChange,
  viewTypeIcons = {},
  config = {},
  onAddView,
  onRenameView,
  onDuplicateView,
  onDeleteView,
  onSetDefaultView,
  onShareView,
  onSaveAsView,
  onPinView,
  onReorderViews,
  onChangeViewType,
  onConfigView,
  onManageViews,
  availableViewTypes,
  hasUnsavedChanges = false,
  onResetChanges,
  className,
}) => {
  const {
    showAddButton = true,
    inlineRename = true,
    contextMenu: enableContextMenu = true,
    reorderable = false,
    maxVisibleTabs,
    showSaveAsView = true,
    showPinnedSection = true,
    showVisibilityGroups = false,
  } = config;

  const viewTabLabel = useViewTabLabel();
  const addViewLabel = viewTabLabel('view.addView', 'Add View');

  // --- Inline rename state ---
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingViewId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingViewId]);

  const startRename = useCallback((viewId: string) => {
    if (!inlineRename || !onRenameView) return;
    const view = views.find(v => v.id === viewId);
    if (!view) return;
    if (view.readonly) return; // System views cannot be renamed.
    setRenamingViewId(viewId);
    setRenameValue(view.label);
  }, [inlineRename, onRenameView, views]);

  const commitRename = useCallback(() => {
    if (renamingViewId && renameValue.trim() && onRenameView) {
      onRenameView(renamingViewId, renameValue.trim());
    }
    setRenamingViewId(null);
    setRenameValue('');
  }, [renamingViewId, renameValue, onRenameView]);

  const cancelRename = useCallback(() => {
    setRenamingViewId(null);
    setRenameValue('');
  }, []);

  /**
   * Suppress the per-tab readonly lock indicator when *every* view is
   * readonly — in that case the badge is pure noise (no actionable contrast
   * with editable views) and clutters the tab bar. The lock still appears
   * the moment the user creates a saved/editable view alongside the system
   * ones, so the affordance returns when it actually distinguishes things.
   */
  const allReadonly = useMemo(
    () => views.length > 0 && views.every(v => !!v.readonly),
    [views],
  );

  // --- Sort views: pinned first → personal → shared ---
  const sortedViews = useMemo(() => {
    const sorted = [...views];
    sorted.sort((a, b) => {
      // Pinned views first
      if (showPinnedSection) {
        const aPinned = a.isPinned ? 1 : 0;
        const bPinned = b.isPinned ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
      }
      // Visibility grouping: private → team → organization → public
      if (showVisibilityGroups) {
        const aOrder = VISIBILITY_ORDER[a.visibility || 'public'] ?? VISIBILITY_ORDER['public'];
        const bOrder = VISIBILITY_ORDER[b.visibility || 'public'] ?? VISIBILITY_ORDER['public'];
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      return 0;
    });
    return sorted;
  }, [views, showPinnedSection, showVisibilityGroups]);

  // --- How many tabs the strip shows (objectui#12423) ---
  // Derived from the strip's width: every tab is drawn once and measured
  // before paint (a layout effect), then the ones that do not fit fold into
  // the "N more" menu. A resize re-fits from the remembered widths without
  // re-drawing. Where nothing is laid out (no layout engine, a hidden strip)
  // the width answers nothing and every tab shows. `maxVisibleTabs` caps the
  // count on top of the width; it no longer decides it alone.
  const stripRef = useRef<HTMLDivElement>(null);
  const tabWidthsRef = useRef(new Map<string, number>());
  const overflowWidthRef = useRef(OVERFLOW_TRIGGER_ESTIMATE_PX);
  /** Everything a tab's drawn width depends on; a change re-measures. */
  const measureKey = useMemo(
    () => JSON.stringify([
      activeViewId,
      sortedViews.map(v => [v.id, v.label, v.type, !!v.isPinned, !!v.readonly, v.visibility ?? '']),
    ]),
    [activeViewId, sortedViews],
  );
  const [fit, setFit] = useState<{ key: string; count: number | null } | null>(null);
  const measuring = fit?.key !== measureKey;

  const fitFromWidths = useCallback((): number | null => {
    const available = layoutWidth(stripRef.current);
    if (available === 0) return null;
    const widths = sortedViews.map(v => (tabWidthsRef.current.get(v.id) ?? 0) + TAB_GAP_PX);
    const activeIndex = sortedViews.findIndex(v => v.id === activeViewId);
    return fitVisibleTabCount(widths, available, overflowWidthRef.current, activeIndex);
  }, [sortedViews, activeViewId]);

  useLayoutEffect(() => {
    if (!measuring) return;
    const strip = stripRef.current;
    if (strip) {
      for (const frame of Array.from(strip.querySelectorAll<HTMLElement>('[data-view-tab-frame]'))) {
        const id = frame.getAttribute('data-view-tab-frame');
        if (id != null) tabWidthsRef.current.set(id, layoutWidth(frame));
      }
    }
    setFit({ key: measureKey, count: fitFromWidths() });
  }, [measuring, measureKey, fitFromWidths]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const count = fitFromWidths();
      setFit(prev => (prev && prev.key === measureKey && prev.count === count ? prev : { key: measureKey, count }));
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measureKey, fitFromWidths]);

  // The trigger's own width, remembered from its last draw for the next fit.
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const w = layoutWidth(overflowTriggerRef.current);
    if (w > 0) overflowWidthRef.current = w + TAB_GAP_PX;
  });

  const visibleCount = Math.min(
    measuring || fit?.count == null ? sortedViews.length : fit.count,
    typeof maxVisibleTabs === 'number' && maxVisibleTabs > 0 ? maxVisibleTabs : Infinity,
  );

  // --- Overflow ---
  // Ensure the active view is always visible (Airtable parity) — promote it
  // from overflow into the visible set so users never lose track of where
  // they are after creating/duplicating a view.
  const { visibleViews, overflowViews } = useMemo(() => {
    const head = sortedViews.slice(0, visibleCount);
    const tail = sortedViews.slice(visibleCount);
    const activeInTail = tail.findIndex(v => v.id === activeViewId);
    if (activeInTail === -1) return { visibleViews: head, overflowViews: tail };
    const promoted = tail[activeInTail];
    const newHead = head.length > 0 ? [...head.slice(0, -1), promoted] : [promoted];
    const demoted = head.length > 0 ? head[head.length - 1] : null;
    const newTail = tail.filter((_, i) => i !== activeInTail);
    if (demoted) newTail.unshift(demoted);
    return { visibleViews: newHead, overflowViews: newTail };
  }, [sortedViews, visibleCount, activeViewId]);

  // --- Drag-reorder sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderViews) return;
    const oldIndex = sortedViews.findIndex(v => v.id === active.id);
    const newIndex = sortedViews.findIndex(v => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedViews, oldIndex, newIndex);
    onReorderViews(reordered.map(v => v.id));
  }, [sortedViews, onReorderViews]);

  const DefaultIcon = TableIcon;

  // Determine if a visibility separator should appear before this view
  const shouldShowVisibilitySeparator = useCallback((index: number) => {
    if (!showVisibilityGroups || index === 0) return false;
    const prev = visibleViews[index - 1];
    const curr = visibleViews[index];
    const isPrivate = (v: ViewTabItem) => v.visibility === 'private';
    return isPrivate(prev) && !isPrivate(curr);
  }, [showVisibilityGroups, visibleViews]);

  // --- Render a single tab ---
  const renderTab = (view: ViewTabItem, index: number) => {
    const isActive = view.id === activeViewId;
    // A table tab is its label alone; any other type shows the icon the host
    // maps it to, and none when the host maps none (objectui#12423).
    const ViewIcon = TABULAR_VIEW_TYPES.has(view.type) ? undefined : viewTypeIcons[view.type];
    const isRenaming = renamingViewId === view.id;
    const showSeparator = shouldShowVisibilitySeparator(index);
    /**
     * System / read-only views suppress mutation menu items so the UI does
     * not advertise actions that would no-op (or worse, surprise the user
     * by silently failing in the host's onRename/onDelete handlers).
     */
    const isReadonly = !!view.readonly;

    /**
     * This tab's menu entries, each resolved ONCE to the handler it will run —
     * or `undefined` when the entry will not render. Every entry, every
     * separator and both menus' triggers read these same values, so a
     * separator is drawn only between two groups that both rendered, and a
     * menu opens only when at least one entry survives.
     *
     * Before objectui#10209 each separator stated its own condition instead of
     * "did anything render above me", so a read-only tab's dropdown opened on
     * a leading rule above "Manage all views…"; and the trigger asked whether
     * a CALLBACK was wired rather than whether an ENTRY would render, so a
     * read-only tab with no `onManageViews` opened an empty dropdown.
     */
    const configAction = isReadonly ? undefined : onConfigView;
    const renameAction = onRenameView && !isReadonly ? startRename : undefined;
    const duplicateAction = onDuplicateView;
    const shareAction = onShareView;
    const setDefaultAction = isReadonly ? undefined : onSetDefaultView;
    const pinAction = isReadonly ? undefined : onPinView;
    const changeType =
      !isReadonly && onChangeViewType && availableViewTypes && availableViewTypes.length > 0
        ? { run: onChangeViewType, types: availableViewTypes }
        : undefined;
    const deleteAction = isReadonly ? undefined : onDeleteView;
    const manageAction = onManageViews;
    /** Entries both menus open with. */
    const hasCommonEntry =
      !!(renameAction || duplicateAction || shareAction || setDefaultAction || pinAction);
    // Dropdown groups: [config · common · change type] | [delete] | [manage].
    const dropdownHasEntryAboveDelete = !!configAction || hasCommonEntry || !!changeType;
    const dropdownHasEntryAboveManage = dropdownHasEntryAboveDelete || !!deleteAction;
    const dropdownHasEntry = dropdownHasEntryAboveManage || !!manageAction;
    // Context menu groups: [common] | [change type] | [delete] | [manage].
    const contextHasEntryAboveDelete = hasCommonEntry || !!changeType;
    const contextHasEntryAboveManage = contextHasEntryAboveDelete || !!deleteAction;
    const contextHasEntry = contextHasEntryAboveManage || !!manageAction;

    const getVisibilityIcon = (view: ViewTabItem) => {
      if (!showVisibilityGroups) return null;
      if (view.visibility === 'private') {
        return <Lock data-testid={`view-tab-visibility-${view.id}`} className="h-3 w-3 text-muted-foreground shrink-0" />;
      }
      if (view.visibility) {
        return <Globe data-testid={`view-tab-visibility-${view.id}`} className="h-3 w-3 text-muted-foreground shrink-0" />;
      }
      return null;
    };

    const visibilityIcon = getVisibilityIcon(view);

    /**
     * The "Set as default" entry, which since objectui#12423 also carries the
     * state the tab's star used to show: on the default view the star is
     * filled and a check closes the row, and the item says `aria-current`.
     */
    const defaultEntryFace = (
      <>
        <Star className={cn('h-4 w-4 mr-2', view.isDefault && 'fill-amber-500 text-amber-500')} />
        {viewTabLabel('view.setAsDefault', 'Set as default')}
        {view.isDefault && (
          <Check
            aria-hidden="true"
            data-testid={`view-tab-default-check-${view.id}`}
            className="ml-auto pl-2 h-4 w-6 shrink-0"
          />
        )}
      </>
    );

    const hasActionsMenu = isActive && dropdownHasEntry;

    const buildTabFace = (dragHandleProps?: { isDragging?: boolean }) => (
      <>
        {reorderable && onReorderViews && (
          <span
            data-testid={`view-tab-drag-handle-${view.id}`}
            aria-hidden="true"
            className={cn(
              'text-muted-foreground transition-opacity pointer-events-none',
              'opacity-0 group-hover/tab:opacity-100',
              dragHandleProps?.isDragging && 'opacity-100'
            )}
          >
            <GripVertical className="h-3 w-3" />
          </span>
        )}
        {showPinnedSection && view.isPinned && (
          <Pin data-testid={`view-tab-pin-indicator-${view.id}`} className="h-3 w-3 text-primary shrink-0" />
        )}
        {visibilityIcon}
        {ViewIcon && <ViewIcon data-testid={`view-tab-type-icon-${view.id}`} className="h-3.5 w-3.5" />}
        {isRenaming ? (
          <Input
            ref={renameInputRef}
            data-testid={`view-tab-rename-input-${view.id}`}
            value={renameValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            aria-label={viewTabLabel('view.rename', 'Rename')}
            className="h-5 w-24 px-1 py-0 text-sm border-none focus-visible:ring-1"
            onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
          />
        ) : (
          <span>{view.label}</span>
        )}
        {isReadonly && !allReadonly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock
                data-testid={`view-tab-readonly-${view.id}`}
                aria-label={viewTabLabel('view.readonlyAriaLabel', 'Read-only view')}
                className="h-3 w-3 text-muted-foreground shrink-0"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {view.readonlyReason || viewTabLabel('view.readonlyTooltip', 'System view — defined in code, read-only.')}
            </TooltipContent>
          </Tooltip>
        )}
        {/* No default-view star on the tab since objectui#12423: the tab's
            "Set as default" entry says which view is the default. */}
      </>
    );

    // `ml-2` = the face's `gap-1.5` plus the `ml-0.5` this trigger had when it
    // sat inside the tab, and `mr-3` the tab's own right padding, so the
    // active tab keeps its measure now that the trigger is the frame's.
    const buildActionsMenu = () => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid={`view-tab-actions-${view.id}`}
                className="ml-2 mr-3 h-4 w-4 flex items-center justify-center rounded hover:bg-accent shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={viewTabLabel('view.tabActionsFor', `View actions for ${view.label}`, { name: view.label })}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* The view's description heads its own menu (objectui#12528):
                  the one place a touch user, who gets no tooltip, can read it.
                  `hasActionsMenu` guarantees an entry below the rule. */}
              {view.description && (
                <>
                  <DropdownMenuLabel
                    data-testid={`view-tab-menu-description-${view.id}`}
                    className="max-w-[280px] whitespace-normal text-xs font-normal text-muted-foreground"
                  >
                    {view.description}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              {configAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-config-${view.id}`}
                  onClick={() => configAction(view.id)}
                >
                  <Settings2 className="h-4 w-4 mr-2" /> {viewTabLabel('view.editViewConfig', 'Edit view config')}
                </DropdownMenuItem>
              )}
              {renameAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-rename-${view.id}`}
                  onClick={() => renameAction(view.id)}
                >
                  <Pencil className="h-4 w-4 mr-2" /> {viewTabLabel('view.rename', 'Rename')}
                </DropdownMenuItem>
              )}
              {duplicateAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-duplicate-${view.id}`}
                  onClick={() => duplicateAction(view.id)}
                >
                  <Copy className="h-4 w-4 mr-2" /> {viewTabLabel('view.duplicateView', 'Duplicate view')}
                </DropdownMenuItem>
              )}
              {shareAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-share-${view.id}`}
                  onClick={() => shareAction(view.id)}
                >
                  <Share2 className="h-4 w-4 mr-2" /> {viewTabLabel('view.shareView', 'Share view')}
                </DropdownMenuItem>
              )}
              {setDefaultAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-default-${view.id}`}
                  aria-current={view.isDefault ? 'true' : undefined}
                  onClick={() => setDefaultAction(view.id)}
                >
                  {defaultEntryFace}
                </DropdownMenuItem>
              )}
              {pinAction && (
                <DropdownMenuItem
                  data-testid={`view-tab-menu-pin-${view.id}`}
                  onClick={() => pinAction(view.id, !view.isPinned)}
                >
                  {view.isPinned
                    ? <><PinOff className="h-4 w-4 mr-2" /> {viewTabLabel('view.unpinView', 'Unpin view')}</>
                    : <><Pin className="h-4 w-4 mr-2" /> {viewTabLabel('view.pinView', 'Pin view')}</>}
                </DropdownMenuItem>
              )}
              {changeType && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid={`view-tab-menu-change-type-${view.id}`}>
                    <LayoutGrid className="h-4 w-4 mr-2" /> {viewTabLabel('view.changeViewType', 'Change view type')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {changeType.types.map((vt) => {
                      const TypeIcon = viewTypeIcons[vt.type] || DefaultIcon;
                      return (
                        <DropdownMenuItem
                          key={vt.type}
                          data-testid={`view-tab-menu-type-${view.id}-${vt.type}`}
                          disabled={vt.type === view.type}
                          onClick={() => changeType.run(view.id, vt.type)}
                        >
                          <TypeIcon className="h-4 w-4 mr-2" />
                          <span>{vt.label}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {deleteAction && (
                <>
                  {dropdownHasEntryAboveDelete && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    data-testid={`view-tab-menu-delete-${view.id}`}
                    onClick={() => deleteAction(view.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> {viewTabLabel('view.deleteView', 'Delete view')}
                  </DropdownMenuItem>
                </>
              )}
              {manageAction && (
                <>
                  {dropdownHasEntryAboveManage && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    data-testid={`view-tab-menu-manage-${view.id}`}
                    onClick={manageAction}
                  >
                    <ListOrdered className="h-4 w-4 mr-2" /> {viewTabLabel('view.manageAllViews', 'Manage all views…')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
    );

    // objectui#11690 — the tab is a FRAME holding two sibling controls: the
    // view button (switch / rename / drag) and, on the active view, the
    // actions-menu button. Neither sits inside the other, because a control
    // inside a control is announced as one and its inner half cannot be
    // reached (axe `nested-interactive`). Nor are they `role="tab"`s: a tab's
    // children are presentational and a `tablist` may own nothing but tabs, so
    // under tab roles the actions button could be neither inside a tab nor
    // beside one — and these views were never ARIA tabs anyway (no arrow-key
    // roving, no tabpanel): every view is its own Tab stop that Enter / Space
    // switches to, which is exactly a button. The current view says so with
    // `aria-current`.
    const buildTabContent = (dragHandleProps?: {
      listeners: DraggableSyntheticListeners;
      attributes: Record<string, unknown>;
      isDragging?: boolean;
    }) => (
      <div
        data-view-tab-frame={view.id}
        className={cn(
          'group/tab inline-flex shrink-0 items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap relative',
          isActive
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        )}
      >
        {isRenaming ? (
          <div className={cn('inline-flex items-center gap-1.5 py-2 pl-3', hasActionsMenu ? 'pr-0' : 'pr-3')}>
            {buildTabFace(dragHandleProps)}
          </div>
        ) : (
          <button
            type="button"
            data-testid={`view-tab-${view.id}`}
            aria-current={isActive ? 'true' : undefined}
            // The active view's description is its tooltip (objectui#12528).
            title={isActive && view.description ? view.description : undefined}
            onClick={() => onViewChange(view.id)}
            onDoubleClick={() => startRename(view.id)}
            {...(dragHandleProps?.listeners ?? {})}
            {...(dragHandleProps?.attributes ?? {})}
            className={cn(
              'inline-flex items-center gap-1.5 py-2 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring',
              hasActionsMenu ? 'pr-0' : 'pr-3',
              dragHandleProps?.isDragging ? 'cursor-grabbing' : 'cursor-pointer',
            )}
          >
            {buildTabFace(dragHandleProps)}
          </button>
        )}
        {hasActionsMenu && buildActionsMenu()}
      </div>
    );

    const wrapWithContextMenu = (tabContent: React.ReactElement) => {
      if (!enableContextMenu || isRenaming || !contextHasEntry) return tabContent;

      return (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {tabContent}
          </ContextMenuTrigger>
          <ContextMenuContent>
            {renameAction && (
              <ContextMenuItem
                data-testid={`context-menu-rename-${view.id}`}
                onClick={() => renameAction(view.id)}
              >
                <Pencil className="h-4 w-4 mr-2" /> {viewTabLabel('view.rename', 'Rename')}
              </ContextMenuItem>
            )}
            {duplicateAction && (
              <ContextMenuItem
                data-testid={`context-menu-duplicate-${view.id}`}
                onClick={() => duplicateAction(view.id)}
              >
                <Copy className="h-4 w-4 mr-2" /> {viewTabLabel('view.duplicateView', 'Duplicate view')}
              </ContextMenuItem>
            )}
            {shareAction && (
              <ContextMenuItem
                data-testid={`context-menu-share-${view.id}`}
                onClick={() => shareAction(view.id)}
              >
                <Share2 className="h-4 w-4 mr-2" /> {viewTabLabel('view.shareView', 'Share view')}
              </ContextMenuItem>
            )}
            {setDefaultAction && (
              <ContextMenuItem
                data-testid={`context-menu-default-${view.id}`}
                aria-current={view.isDefault ? 'true' : undefined}
                onClick={() => setDefaultAction(view.id)}
              >
                {defaultEntryFace}
              </ContextMenuItem>
            )}
            {pinAction && (
              <ContextMenuItem
                data-testid={`context-menu-pin-${view.id}`}
                onClick={() => pinAction(view.id, !view.isPinned)}
              >
                {view.isPinned
                  ? <><PinOff className="h-4 w-4 mr-2" /> {viewTabLabel('view.unpinView', 'Unpin view')}</>
                  : <><Pin className="h-4 w-4 mr-2" /> {viewTabLabel('view.pinView', 'Pin view')}</>
                }
              </ContextMenuItem>
            )}
            {changeType && (
              <>
                {hasCommonEntry && <ContextMenuSeparator />}
                <ContextMenuSub>
                  <ContextMenuSubTrigger data-testid={`context-menu-change-type-${view.id}`}>
                    <LayoutGrid className="h-4 w-4 mr-2" /> {viewTabLabel('view.changeViewType', 'Change view type')}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent data-testid={`context-menu-type-submenu-${view.id}`}>
                    {changeType.types.map((vt) => {
                      const TypeIcon = viewTypeIcons[vt.type] || DefaultIcon;
                      return (
                        <ContextMenuItem
                          key={vt.type}
                          data-testid={`context-menu-type-${view.id}-${vt.type}`}
                          disabled={vt.type === view.type}
                          onClick={() => changeType.run(view.id, vt.type)}
                        >
                          <TypeIcon className="h-4 w-4 mr-2" />
                          <div className="flex flex-col">
                            <span>{vt.label}</span>
                            {vt.description && (
                              <span className="text-xs text-muted-foreground">{vt.description}</span>
                            )}
                          </div>
                        </ContextMenuItem>
                      );
                    })}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            )}
            {deleteAction && (
              <>
                {contextHasEntryAboveDelete && <ContextMenuSeparator />}
                <ContextMenuItem
                  data-testid={`context-menu-delete-${view.id}`}
                  onClick={() => deleteAction(view.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> {viewTabLabel('view.deleteView', 'Delete view')}
                </ContextMenuItem>
              </>
            )}
            {manageAction && (
              <>
                {contextHasEntryAboveManage && <ContextMenuSeparator />}
                <ContextMenuItem
                  data-testid={`context-menu-manage-${view.id}`}
                  onClick={manageAction}
                >
                  <ListOrdered className="h-4 w-4 mr-2" /> {viewTabLabel('view.manageAllViews', 'Manage all views…')}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      );
    };

    // Build the tab with optional drag-reorder wrapper
    if (reorderable && onReorderViews) {
      return (
        <React.Fragment key={view.id}>
          {showSeparator && (
            <div data-testid="view-tab-visibility-separator" className="w-px h-5 bg-border mx-1 self-center shrink-0" />
          )}
          <SortableTab id={view.id}>
            {({ setNodeRef, style, listeners, attributes, isDragging }) => (
              <div ref={setNodeRef} style={style} className={cn('flex shrink-0', isDragging && 'z-10')}>
                {wrapWithContextMenu(buildTabContent({ listeners, attributes, isDragging }))}
              </div>
            )}
          </SortableTab>
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={view.id}>
        {showSeparator && (
          <div data-testid="view-tab-visibility-separator" className="w-px h-5 bg-border mx-1 self-center shrink-0" />
        )}
        {wrapWithContextMenu(buildTabContent())}
      </React.Fragment>
    );
  };

  const tabList = (
    <>
      {visibleViews.map((view, index) => renderTab(view, index))}
    </>
  );

  return (
    <TooltipProvider>
      {/* The bar takes its container's width (`w-full`), whatever the host:
          in a flex slot (the list toolbar's leading slot, objectui#12440) a
          bar without it is sized by its content, so the strip below measures
          the tabs it is drawing and the fit answers its own last answer — once
          one tab is drawn, one tab is all that fits (objectui#12518). `w-full`
          rather than `flex-1` so a column-flex host is not grown vertically;
          in a block host it is the width the bar already had. */}
      <div
        data-testid="view-tab-bar"
        className={cn('flex w-full min-w-0 items-center gap-0.5 -mb-px', className)}
      >
        {/* The strip: the tabs and their "N more" trigger, in whatever width
            the bar's other controls leave. `flex-1` with a zero basis, so its
            width never depends on how many tabs it holds — that is what lets
            the count be derived from it (objectui#12423). */}
        <div
          ref={stripRef}
          data-testid="view-tab-strip"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-clip"
        >
        {/* Visible tabs — optionally wrapped with DndContext for reorder */}
        {reorderable && onReorderViews ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleViews.map(v => v.id)} strategy={horizontalListSortingStrategy}>
              <div data-testid="view-tab-sortable-container" className="flex items-center gap-0.5">
                {tabList}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          tabList
        )}

        {/* Overflow "More" dropdown */}
        {overflowViews.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button"
                ref={overflowTriggerRef}
                data-testid="view-tab-overflow"
                className="inline-flex shrink-0 items-center gap-1 px-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="text-xs">{viewTabLabel('view.moreViews', `${overflowViews.length} more`, { count: overflowViews.length })}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onManageViews && (
                <>
                  <DropdownMenuItem
                    data-testid="view-tab-overflow-manage"
                    onClick={onManageViews}
                    className="font-medium"
                  >
                    <ListOrdered className="h-4 w-4 mr-2" /> {viewTabLabel('view.manageAllViews', 'Manage all views…')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {overflowViews.map((view) => {
                const ViewIcon = viewTypeIcons[view.type] || DefaultIcon;
                return (
                  <DropdownMenuItem
                    key={view.id}
                    data-testid={`view-tab-overflow-${view.id}`}
                    onClick={() => onViewChange(view.id)}
                  >
                    {view.isPinned && <Pin className="h-3 w-3 mr-1 text-primary shrink-0" />}
                    <ViewIcon className="h-4 w-4 mr-2" />
                    {view.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        </div>

        {/* Inline "+" Add View button — an icon alone names nothing, so the
            tooltip's words are its accessible name too (objectui#11690). */}
        {showAddButton && onAddView && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button"
                data-testid="view-tab-add"
                onClick={onAddView}
                aria-label={addViewLabel}
                className="inline-flex shrink-0 items-center px-2 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{addViewLabel}</TooltipContent>
          </Tooltip>
        )}

        {/* "Save as View" indicator */}
        {showSaveAsView && hasUnsavedChanges && (
          <div
            data-testid="view-tab-save-as"
            className="flex shrink-0 items-center gap-1 ml-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Unsaved changes</span>
            {onSaveAsView && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="view-tab-save-as-btn"
                className="h-6 px-2 text-xs"
                onClick={onSaveAsView}
              >
                Save as View
              </Button>
            )}
            {onResetChanges && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="view-tab-reset-btn"
                className="h-6 px-2 text-xs"
                onClick={onResetChanges}
              >
                Reset
              </Button>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

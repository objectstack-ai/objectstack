/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback, type ComponentType } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@object-ui/components';
import {
  GripVertical,
  Search,
  Plus,
  Pin,
  PinOff,
  Star,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Table as TableIcon,
  Check,
  X,
  Lock,
} from 'lucide-react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/react';
import type { ViewTabItem } from './ViewTabBar';

/**
 * Translation helper resilient to rendering outside an I18nProvider (mirrors
 * ViewTabBar.useViewTabLabel): returns the English `fallback` when the key is
 * missing or the provider is absent.
 */
function useViewLabel() {
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

export interface ManageViewsDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** All views (metadata + saved) */
  views: ViewTabItem[];
  /** Currently active view ID */
  activeViewId?: string;
  /** Icon map: view type → React component */
  viewTypeIcons?: Record<string, ComponentType<{ className?: string }>>;

  // --- Action callbacks (reuse the same handlers from ObjectView) ---
  onRename?: (viewId: string, newName: string) => void;
  onDelete?: (viewId: string) => void;
  /**
   * Opt-in duplicate action — the row's "Duplicate" button renders only when
   * wired. Deliberate generic affordance (not dead code); the console defers
   * view duplication to per-user personalisation (objectui#1520). Omit to hide.
   */
  onDuplicate?: (viewId: string) => void;
  onSetDefault?: (viewId: string) => void;
  onSetPinned?: (viewId: string, pinned: boolean) => void;
  onReorder?: (viewIds: string[]) => void;
  onAddView?: () => void;
  /** Open the edit-config drawer for a view (closes the dialog first) */
  onConfigView?: (viewId: string) => void;
}

const DEFAULT_ICON: ComponentType<{ className?: string }> = TableIcon;

// --- Single sortable row ---
interface RowProps {
  view: ViewTabItem;
  isActive: boolean;
  Icon: ComponentType<{ className?: string }>;
  isRenaming: boolean;
  /**
   * Undefined when the host wired no `onRename`: committing a rename would
   * then call nothing, so the row must not offer to start one.
   */
  onStartRename?: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onRowClick?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onSetDefault?: (id: string) => void;
  onSetPinned?: (id: string, pinned: boolean) => void;
  onConfigView?: (id: string) => void;
}

const SortableRow: React.FC<RowProps> = ({
  view,
  isActive,
  Icon,
  isRenaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRowClick,
  onDelete,
  onDuplicate,
  onSetDefault,
  onSetPinned,
  onConfigView,
}) => {
  const vt = useViewLabel();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: view.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState(view.label);
  // System / read-only views suppress mutation affordances (rename, set
  // default, pin, edit configuration, delete). Duplicate is preserved
  // because it produces a fresh override that *is* mutable.
  const isReadonly = !!view.readonly;

  /**
   * The overflow menu's entries, each resolved ONCE to the handler it will
   * run — or `undefined` when that entry will not render. The entries, the
   * separator above Delete and the `…` trigger all read these same values,
   * so the trigger can never open a menu whose every entry dropped out.
   *
   * The trigger used to ask a different question — "is a callback wired?" —
   * while each entry also asked `!isReadonly`. On a read-only row (the
   * console wires no `onDuplicate`, objectui#1520) every entry dropped out and
   * the trigger opened an empty 180px-wide strip of popover (objectui#10209).
   */
  const renameAction = isReadonly ? undefined : onStartRename;
  const duplicateAction = onDuplicate;
  const configAction = isReadonly ? undefined : onConfigView;
  const setDefaultAction = isReadonly || view.isDefault ? undefined : onSetDefault;
  const pinAction = isReadonly ? undefined : onSetPinned;
  const deleteAction = isReadonly ? undefined : onDelete;
  const hasEntryAboveDelete =
    !!(renameAction || duplicateAction || configAction || setDefaultAction || pinAction);
  const hasMenuEntry = hasEntryAboveDelete || !!deleteAction;

  useEffect(() => {
    if (isRenaming) {
      setDraftName(view.label);
      // focus on next tick once the input is in the DOM
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, view.label]);

  const commit = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== view.label) onCommitRename(view.id, trimmed);
    else onCancelRename();
  }, [draftName, view.id, view.label, onCommitRename, onCancelRename]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`manage-views-row-${view.id}`}
      className={cn(
        'group/row flex items-center gap-2 px-2 py-2 rounded-md border border-transparent',
        'hover:bg-accent/50 transition-colors',
        isActive && 'bg-accent/40 border-border',
        isDragging && 'shadow-md bg-background border-border z-10',
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={vt('view.dragToReorder', 'Drag to reorder')}
        data-testid={`manage-views-drag-${view.id}`}
        className="shrink-0 h-6 w-5 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing rounded hover:bg-accent"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* View type icon */}
      <Icon className="shrink-0 h-4 w-4 text-muted-foreground" />

      {/* Name (editable) */}
      <div
        className="flex-1 min-w-0"
        onClick={() => {
          if (!isRenaming) onRowClick?.(view.id);
        }}
      >
        {isRenaming ? (
          <Input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelRename();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-7 text-sm"
            data-testid={`manage-views-rename-input-${view.id}`}
          />
        ) : (
          <button
            type="button"
            className="w-full text-left text-sm font-medium truncate cursor-pointer flex items-center gap-1.5"
            onDoubleClick={(e) => {
              e.stopPropagation();
              renameAction?.(view.id);
            }}
            title={view.label}
          >
            <span className="truncate">{view.label}</span>
            {isReadonly && (
              <Lock
                aria-label={vt('view.readonlyAriaLabel', 'Read-only view')}
                data-testid={`manage-views-readonly-${view.id}`}
                className="h-3 w-3 text-muted-foreground shrink-0"
              />
            )}
            {view.isDefault && (
              <span
                className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wide text-muted-foreground"
                title={vt('view.defaultView', 'Default view')}
              >
                <Star className="h-3 w-3 mr-0.5 fill-current" /> {vt('view.defaultBadge', 'default')}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Pin toggle */}
      {onSetPinned && !isRenaming && !isReadonly && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={view.isPinned ? vt('view.unpinView', 'Unpin View') : vt('view.pinView', 'Pin View')}
                data-testid={`manage-views-pin-${view.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetPinned(view.id, !view.isPinned);
                }}
                className={cn(
                  'shrink-0 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors',
                  view.isPinned ? 'text-amber-500' : 'text-muted-foreground/40 opacity-0 group-hover/row:opacity-100',
                )}
              >
                {view.isPinned ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {view.isPinned ? vt('view.unpinView', 'Unpin View') : vt('view.pinView', 'Pin View')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Set default */}
      {onSetDefault && !isRenaming && !view.isDefault && !isReadonly && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={vt('view.setAsDefault', 'Set as Default')}
                data-testid={`manage-views-default-${view.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetDefault(view.id);
                }}
                className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/row:opacity-100 transition-colors"
              >
                <Star className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{vt('view.setAsDefault', 'Set as Default')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Overflow menu */}
      {!isRenaming && hasMenuEntry && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={vt('view.tabActionsFor', `View actions for ${view.label}`, { name: view.label })}
              data-testid={`manage-views-actions-${view.id}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground opacity-60 group-hover/row:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            {renameAction && (
              <DropdownMenuItem
                data-testid={`manage-views-action-rename-${view.id}`}
                onClick={() => renameAction(view.id)}
              >
                <Pencil className="h-4 w-4 mr-2" /> {vt('view.rename', 'Rename')}
              </DropdownMenuItem>
            )}
            {duplicateAction && (
              <DropdownMenuItem
                data-testid={`manage-views-action-duplicate-${view.id}`}
                onClick={() => duplicateAction(view.id)}
              >
                <Copy className="h-4 w-4 mr-2" /> {vt('view.duplicateView', 'Duplicate View')}
              </DropdownMenuItem>
            )}
            {configAction && (
              <DropdownMenuItem
                data-testid={`manage-views-action-config-${view.id}`}
                onClick={() => configAction(view.id)}
              >
                <Pencil className="h-4 w-4 mr-2" /> {vt('view.editViewConfig', 'Edit view config')}
              </DropdownMenuItem>
            )}
            {setDefaultAction && (
              <DropdownMenuItem
                data-testid={`manage-views-action-default-${view.id}`}
                onClick={() => setDefaultAction(view.id)}
              >
                <Star className="h-4 w-4 mr-2" /> {vt('view.setAsDefault', 'Set as Default')}
              </DropdownMenuItem>
            )}
            {pinAction && (
              <DropdownMenuItem
                data-testid={`manage-views-action-pin-${view.id}`}
                onClick={() => pinAction(view.id, !view.isPinned)}
              >
                {view.isPinned
                  ? <><PinOff className="h-4 w-4 mr-2" /> {vt('view.unpinView', 'Unpin View')}</>
                  : <><Pin className="h-4 w-4 mr-2" /> {vt('view.pinView', 'Pin View')}</>}
              </DropdownMenuItem>
            )}
            {deleteAction && (
              <>
                {hasEntryAboveDelete && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  data-testid={`manage-views-action-delete-${view.id}`}
                  onClick={() => deleteAction(view.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> {vt('view.deleteView', 'Delete View')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isRenaming && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label={vt('common.save', 'Save')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={commit}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-emerald-600"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={vt('common.cancel', 'Cancel')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancelRename}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );
};

export const ManageViewsDialog: React.FC<ManageViewsDialogProps> = ({
  open,
  onOpenChange,
  views,
  activeViewId,
  viewTypeIcons = {},
  onRename,
  onDelete,
  onDuplicate,
  onSetDefault,
  onSetPinned,
  onReorder,
  onAddView,
  onConfigView,
}) => {
  const vt = useViewLabel();
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Local copy so drag reorder feels instant; we sync from props when they change.
  const [orderedIds, setOrderedIds] = useState<string[]>(() => views.map((v) => v.id));

  useEffect(() => {
    setOrderedIds(views.map((v) => v.id));
  }, [views]);

  // When dialog closes, exit rename mode and clear search
  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setSearch('');
    }
  }, [open]);

  const orderedViews = useMemo(() => {
    const byId = new Map(views.map((v) => [v.id, v]));
    return orderedIds.map((id) => byId.get(id)).filter(Boolean) as ViewTabItem[];
  }, [orderedIds, views]);

  const visibleViews = useMemo(() => {
    if (!search.trim()) return orderedViews;
    const q = search.toLowerCase();
    return orderedViews.filter((v) => v.label.toLowerCase().includes(q));
  }, [orderedViews, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedIds, oldIndex, newIndex);
    setOrderedIds(next);
    onReorder?.(next);
  };

  const handleConfig = (id: string) => {
    onOpenChange(false);
    // Defer so the dialog close animation doesn't fight the drawer open
    requestAnimationFrame(() => onConfigView?.(id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px] p-0 gap-0 overflow-hidden"
        data-testid="manage-views-dialog"
      >
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base">{vt('view.manageViews', 'Manage views')}</DialogTitle>
          <DialogDescription className="text-xs">
            {vt('view.manageViewsDescription', 'Reorder, rename, pin, or delete every view in this object.')}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={vt('view.searchViews', 'Search views')}
              className="pl-8 h-9"
              data-testid="manage-views-search"
            />
          </div>
        </div>

        {/* List */}
        <div
          className="px-3 pb-3 max-h-[55vh] overflow-y-auto"
          data-testid="manage-views-list"
        >
          {visibleViews.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              {vt('view.noViewsFound', 'No views match your search.')}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleViews.map((v) => v.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-0.5">
                  {visibleViews.map((view) => {
                    const Icon = viewTypeIcons[view.type] || DEFAULT_ICON;
                    return (
                      <SortableRow
                        key={view.id}
                        view={view}
                        Icon={Icon}
                        isActive={view.id === activeViewId}
                        isRenaming={renamingId === view.id}
                        onStartRename={onRename ? (id) => setRenamingId(id) : undefined}
                        onCancelRename={() => setRenamingId(null)}
                        onCommitRename={(id, name) => {
                          setRenamingId(null);
                          onRename?.(id, name);
                        }}
                        onDelete={onDelete}
                        onDuplicate={onDuplicate}
                        onSetDefault={onSetDefault}
                        onSetPinned={onSetPinned}
                        onConfigView={onConfigView ? handleConfig : undefined}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DialogFooter className="border-t bg-muted/30 px-5 py-3 flex sm:justify-between gap-2">
          {onAddView ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                requestAnimationFrame(() => onAddView());
              }}
              data-testid="manage-views-add"
              className="text-sm"
            >
              <Plus className="h-4 w-4 mr-1.5" /> {vt('view.addNewView', 'Add new view')}
            </Button>
          ) : <span />}
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="manage-views-done"
          >
            {vt('view.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManageViewsDialog;

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFormCanvas — form-designer-style preview for an Object
 * metadata draft. Replaces the legacy CRUD grid in DesignerMode.
 *
 * Each field renders as the labeled input it will become at runtime
 * (via {@link FieldStub}). Clicking a row selects it and the host
 * swaps the inspector to {@link ObjectFieldInspector}. The trailing
 * "+ Add field" button opens a categorized type picker — picking a
 * type appends a fresh field and immediately selects it so authors
 * can fill in name/label in the inspector.
 *
 * All edits go through the host's `onPatch` callback. Read-only
 * surfaces (legacy tier objects, builtin objects) still render the
 * preview but suppress selection chrome + the add button.
 */

import * as React from 'react';
import {
  Badge,
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import {
  GripVertical,
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  FolderInput,
  ChevronsDownUp,
  ChevronsUpDown,
  CheckSquare,
  GitCompareArrows,
  Sparkles,
  X,
} from 'lucide-react';
import type { MetadataSelection } from '../preview-registry.js';
import { requestAssistantOpen } from '../../../assistant/assistantBus.js';
import { useAiSurfaceEnabled } from '../../../hooks/useAiSurface.js';
import {
  readFields,
  writeFields,
  newField,
  toFieldName,
  groupEntries,
  readGroups,
  addGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  clearFieldGroup,
  diffFields,
  type FieldEntry,
  type ObjectFieldGroup,
  type FieldsDiff,
  type FieldDiffStatus,
} from './object-fields-io.js';
import {
  FIELD_TYPE_META,
  TYPES_BY_CATEGORY,
  CATEGORY_TONE,
  type FieldTypeId,
  type FieldTypeMeta,
  type FieldTypeCategory,
} from './field-types.js';
import { FieldStub } from './FieldStub.js';
import { t, tFormat } from '../i18n.js';

/* ─── locale helpers ─── */
// Both resolve through the Studio catalog now. They used to read a `labelZh`
// column on FIELD_TYPE_META behind an `isZh` check, which meant the picker
// only ever spoke English or Chinese (objectui#2871).
const typeLabel = (meta: FieldTypeMeta | undefined, locale?: string): string | undefined =>
  meta ? t(`engine.fieldType.${meta.id}`, locale) : undefined;
const categoryLabel = (cat: FieldTypeCategory, locale?: string): string =>
  t(`engine.fieldCategory.${cat}`, locale);

export interface ObjectFormCanvasProps {
  objectName: string;
  draft: Record<string, unknown>;
  /** Last published version, for the review/diff mode. */
  baseline?: Record<string, unknown>;
  onPatch?: (patch: Record<string, unknown>) => void;
  selection?: MetadataSelection | null;
  onSelectionChange?: (next: MetadataSelection | null) => void;
  locale?: string;
}

export function ObjectFormCanvas({
  objectName,
  draft,
  baseline,
  onPatch,
  selection,
  onSelectionChange,
  locale,
}: ObjectFormCanvasProps) {
  const readOnly = !onPatch;
  // The "Ask AI" affordances arm the global chat FAB (requestAssistantOpen).
  // Hide them when the runtime serves no AI — otherwise they'd dead-end with no
  // FAB to open. Same server-pushed signal the FAB itself gates on.
  const { enabled: aiEnabled } = useAiSurfaceEnabled();

  const view = React.useMemo(() => readFields((draft as any).fields), [draft]);

  /* ─── Review/diff mode — draft vs last published ─── */
  const diff = React.useMemo<FieldsDiff | null>(
    () => (baseline ? diffFields((baseline as any).fields, (draft as any).fields) : null),
    [baseline, draft],
  );
  const changeCount = diff
    ? diff.counts.added + diff.counts.changed + diff.counts.removed
    : 0;
  const [reviewMode, setReviewMode] = React.useState(false);
  // Auto-exit review when nothing differs anymore (e.g. user reverted edits).
  React.useEffect(() => {
    if (reviewMode && changeCount === 0) setReviewMode(false);
  }, [reviewMode, changeCount]);
  const reviewing = reviewMode && changeCount > 0;
  const statusOf = (name: string): FieldDiffStatus | undefined =>
    reviewing ? diff?.byName[name]?.status : undefined;
  const changedKeysOf = (name: string): string[] =>
    reviewing ? diff?.byName[name]?.changedKeys ?? [] : [];
  const declaredGroups = React.useMemo<ObjectFieldGroup[]>(
    () => readGroups((draft as any).fieldGroups),
    [draft],
  );
  const hasGroups = declaredGroups.length > 0;
  // While editing, keep empty declared sections visible as drop targets.
  const groups = React.useMemo(
    () => groupEntries(view, declaredGroups, { includeEmptyDeclared: !readOnly }),
    [view, declaredGroups, readOnly],
  );

  // Collapse state is local UI — keyed by group key (null bucket → "").
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const collapseKey = (key: string | null) => key ?? '__ungrouped__';
  const toggleCollapse = React.useCallback((key: string | null) => {
    const k = key ?? '__ungrouped__';
    setCollapsed((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[collapseKey(g.key)]);
  const setAllCollapsed = React.useCallback(
    (value: boolean) => {
      setCollapsed(() => {
        const next: Record<string, boolean> = {};
        for (const g of groups) next[collapseKey(g.key)] = value;
        return next;
      });
    },
    [groups],
  );

  const selectedName = selection?.kind === 'field' ? String(selection.id) : null;
  const requiredCount = view.entries.filter((e) => !!e.def.required).length;

  const selectField = React.useCallback(
    (entry: FieldEntry) => {
      if (!onSelectionChange) return;
      onSelectionChange({
        kind: 'field',
        id: entry.name,
        label: typeof entry.def.label === 'string' ? (entry.def.label as string) : entry.name,
      });
    },
    [onSelectionChange],
  );

  /* ─── Multi-select (bulk ops) — canvas-local; no host coupling ─── */

  const [multiSel, setMultiSel] = React.useState<Set<string>>(() => new Set());
  const anchorRef = React.useRef<string | null>(null);
  // Flat rendered order, for Shift-range selection.
  const flatNames = React.useMemo(
    () => groups.flatMap((g) => g.entries.map((e) => e.name)),
    [groups],
  );
  // Drop names that no longer exist (e.g. after a bulk delete elsewhere).
  React.useEffect(() => {
    setMultiSel((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set([...prev].filter((n) => view.entries.some((e) => e.name === n)));
      return live.size === prev.size ? prev : live;
    });
  }, [view]);

  const handleRowClick = React.useCallback(
    (entry: FieldEntry, e?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => {
      const name = entry.name;
      if (!readOnly && e && (e.metaKey || e.ctrlKey)) {
        setMultiSel((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
        anchorRef.current = name;
        return;
      }
      if (!readOnly && e && e.shiftKey && anchorRef.current && anchorRef.current !== name) {
        const a = flatNames.indexOf(anchorRef.current);
        const b = flatNames.indexOf(name);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setMultiSel(new Set(flatNames.slice(lo, hi + 1)));
          return;
        }
      }
      // Plain click — clear multi-selection, single-select.
      if (multiSel.size) setMultiSel(new Set());
      anchorRef.current = name;
      selectField(entry);
    },
    [readOnly, flatNames, multiSel, selectField],
  );

  const clearMulti = React.useCallback(() => setMultiSel(new Set()), []);

  const bulkDelete = React.useCallback(() => {
    if (!onPatch || multiSel.size === 0) return;
    const entries = view.entries.filter((e) => !multiSel.has(e.name));
    onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    if (selectedName && multiSel.has(selectedName)) onSelectionChange?.(null);
    setMultiSel(new Set());
  }, [onPatch, multiSel, view, selectedName, onSelectionChange]);

  const bulkSetGroup = React.useCallback(
    (groupKey: string | null) => {
      if (!onPatch || multiSel.size === 0) return;
      const entries = view.entries.map((e) =>
        multiSel.has(e.name)
          ? { name: e.name, def: { ...e.def, group: groupKey ?? undefined } }
          : e,
      );
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    },
    [onPatch, multiSel, view],
  );

  const addField = React.useCallback(
    (type: FieldTypeId, groupKey?: string | null) => {
      if (!onPatch) return;
      const existing = view.entries.map((e) => e.name);
      const base = type === 'select' ? 'status' : type;
      let i = 1;
      let name = base;
      while (existing.includes(name)) {
        i += 1;
        name = `${base}_${i}`;
      }
      const entry = newField(name, type);
      if (groupKey) entry.def = { ...entry.def, group: groupKey };
      // Insert at the end of the target group's run so it lands in-section,
      // otherwise append to the very end (ungrouped / no groups).
      let insertAt = view.entries.length;
      if (groupKey) {
        for (let j = view.entries.length - 1; j >= 0; j -= 1) {
          if (view.entries[j].def.group === groupKey) { insertAt = j + 1; break; }
        }
      }
      const entries = view.entries.slice();
      entries.splice(insertAt, 0, entry);
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
      onSelectionChange?.({
        kind: 'field',
        id: name,
        label: String(entry.def.label ?? name),
      });
    },
    [onPatch, onSelectionChange, view],
  );

  /* ─── Section (field group) operations ─── */

  const addSection = React.useCallback(() => {
    if (!onPatch) return;
    const label = tFormat('designer.canvas.sectionN', locale, {
      n: declaredGroups.length + 1,
    });
    const next = addGroup(declaredGroups, label);
    const created = next[next.length - 1];
    onPatch({ fieldGroups: next });
    // Reveal the new (empty) section if everything was collapsed.
    setCollapsed((prev) => ({ ...prev, [created.key]: false }));
  }, [onPatch, declaredGroups, locale]);

  const renameSection = React.useCallback(
    (key: string, label: string) => {
      if (!onPatch) return;
      onPatch({ fieldGroups: renameGroup(declaredGroups, key, label) });
    },
    [onPatch, declaredGroups],
  );

  const removeSection = React.useCallback(
    (key: string) => {
      if (!onPatch) return;
      // Drop the declaration AND clear `group` from its members so they
      // fall back to the Ungrouped bucket rather than vanishing.
      const clearedView = clearFieldGroup(view, key);
      onPatch({
        fieldGroups: removeGroup(declaredGroups, key),
        fields: writeFields(clearedView),
      });
    },
    [onPatch, declaredGroups, view],
  );

  const moveSection = React.useCallback(
    (key: string, dir: -1 | 1) => {
      if (!onPatch) return;
      onPatch({ fieldGroups: moveGroup(declaredGroups, key, dir) });
    },
    [onPatch, declaredGroups],
  );

  // Reorder fields by moving `fromName` to the position of `toName`.
  // Uses native HTML5 DnD — no library, no animations, just a working
  // reorder for the most common designer interaction.
  // If `toName`'s field is in a different group than the dragged field,
  // adopt that group so cross-group drops are intuitive.
  const reorderField = React.useCallback(
    (fromName: string, toName: string, position: 'before' | 'after') => {
      if (!onPatch) return;
      if (fromName === toName) return;
      const entries = view.entries.slice();
      const fromIdx = entries.findIndex((e) => e.name === fromName);
      if (fromIdx < 0) return;
      const [moved] = entries.splice(fromIdx, 1);
      const toIdx = entries.findIndex((e) => e.name === toName);
      const targetEntry = toIdx >= 0 ? entries[toIdx] : undefined;
      if (targetEntry) {
        const targetGroup = typeof targetEntry.def.group === 'string' ? targetEntry.def.group : undefined;
        const fromGroup = typeof moved.def.group === 'string' ? moved.def.group : undefined;
        if (targetGroup !== fromGroup) {
          moved.def = { ...moved.def, group: targetGroup };
        }
      }
      if (toIdx < 0) {
        entries.push(moved);
      } else {
        entries.splice(position === 'before' ? toIdx : toIdx + 1, 0, moved);
      }
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    },
    [onPatch, view],
  );

  // Keyboard reorder (Alt+↑/↓): swap a field with its nearest neighbour
  // in the SAME group so a focused row moves predictably within its
  // section without ever changing groups.
  const moveFieldByOffset = React.useCallback(
    (name: string, dir: -1 | 1) => {
      if (!onPatch) return;
      const entries = view.entries.slice();
      const idx = entries.findIndex((e) => e.name === name);
      if (idx < 0) return;
      const grp = typeof entries[idx].def.group === 'string' ? entries[idx].def.group : null;
      let j = idx + dir;
      while (j >= 0 && j < entries.length) {
        const g = typeof entries[j].def.group === 'string' ? entries[j].def.group : null;
        if (g === grp) break;
        j += dir;
      }
      if (j < 0 || j >= entries.length) return;
      const tmp = entries[idx];
      entries[idx] = entries[j];
      entries[j] = tmp;
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    },
    [onPatch, view],
  );

  // Drop a field into a group section's empty space (or onto its header).
  // Reassigns Field.group and moves the entry to the end of that group's
  // run in the source order so it visually lands where it was dropped.
  const moveToGroup = React.useCallback(
    (fromName: string, groupKey: string | null) => {
      if (!onPatch) return;
      const entries = view.entries.slice();
      const fromIdx = entries.findIndex((e) => e.name === fromName);
      if (fromIdx < 0) return;
      const [moved] = entries.splice(fromIdx, 1);
      const currentGroup = typeof moved.def.group === 'string' ? moved.def.group : null;
      if (currentGroup === groupKey) {
        // No group change — re-insert at original position (effectively no-op).
        entries.splice(fromIdx, 0, moved);
        return;
      }
      moved.def = { ...moved.def, group: groupKey ?? undefined };
      // Find end of target group's run; if no members, append at end.
      let insertAt = entries.length;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const g = typeof entries[i].def.group === 'string' ? entries[i].def.group : null;
        if (g === groupKey) { insertAt = i + 1; break; }
      }
      entries.splice(insertAt, 0, moved);
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    },
    [onPatch, view],
  );

  // Inline label rename — used by double-click on the field card label.
  const renameLabel = React.useCallback(
    (name: string, nextLabel: string) => {
      if (!onPatch) return;
      const entries = view.entries.map((e) =>
        e.name === name
          ? { name, def: { ...e.def, label: nextLabel || undefined } }
          : e,
      );
      onPatch({ fields: writeFields({ shape: view.shape, entries }) });
    },
    [onPatch, view],
  );

  // Click anywhere on the empty canvas background to clear selection.
  const handleBgClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && selectedName) {
        onSelectionChange?.(null);
      }
    },
    [onSelectionChange, selectedName],
  );

  const emptyState = view.entries.length === 0;
  // Section chrome (headers, collapse, drop-to-assign) only appears once
  // groups exist — otherwise the canvas stays a flat field list.
  const showSectionChrome = hasGroups || groups.length > 1;

  return (
    <div
      className="h-full overflow-auto bg-muted/20"
      onClick={handleBgClick}
      data-object-name={objectName}
    >
      {!readOnly && multiSel.size > 0 && (
        <BulkActionBar
          count={multiSel.size}
          groups={declaredGroups}
          onMoveToGroup={bulkSetGroup}
          onDelete={bulkDelete}
          onClear={clearMulti}
          locale={locale}
        />
      )}
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-4" onClick={handleBgClick}>
        {!emptyState && (
          <CanvasToolbar
            fieldCount={view.entries.length}
            requiredCount={requiredCount}
            sectionCount={declaredGroups.length}
            allCollapsed={allCollapsed}
            onToggleAll={showSectionChrome ? () => setAllCollapsed(!allCollapsed) : undefined}
            reviewAvailable={changeCount > 0}
            reviewing={reviewing}
            diffCounts={diff?.counts}
            onToggleReview={() => setReviewMode((v) => !v)}
            locale={locale}
          />
        )}

        {emptyState ? (
          <EmptyCanvas onAdd={readOnly ? undefined : addField} locale={locale} aiEnabled={aiEnabled} />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const declaredIdx = g.key
                ? declaredGroups.findIndex((d) => d.key === g.key)
                : -1;
              return (
                <GroupSection
                  key={g.key ?? '__ungrouped__'}
                  groupKey={g.key}
                  label={g.key === null ? t('designer.canvas.ungrouped', locale) : g.label}
                  count={g.entries.length}
                  showHeader={showSectionChrome}
                  collapsed={!!collapsed[collapseKey(g.key)]}
                  onToggleCollapse={() => toggleCollapse(g.key)}
                  readOnly={readOnly}
                  locale={locale}
                  canMoveUp={declaredIdx > 0}
                  canMoveDown={declaredIdx >= 0 && declaredIdx < declaredGroups.length - 1}
                  onRename={g.key ? (label) => renameSection(g.key!, label) : undefined}
                  onRemove={g.key ? () => removeSection(g.key!) : undefined}
                  onMove={g.key ? (dir) => moveSection(g.key!, dir) : undefined}
                  onAddField={readOnly ? undefined : (type) => addField(type, g.key)}
                  onDropField={readOnly ? undefined : moveToGroup}
                >
                  {g.entries.map((entry) => (
                    <FieldRow
                      key={entry.name}
                      entry={entry}
                      selected={entry.name === selectedName}
                      multiSelected={multiSel.has(entry.name)}
                      diffStatus={statusOf(entry.name)}
                      changedKeys={changedKeysOf(entry.name)}
                      readOnly={readOnly}
                      locale={locale}
                      onClick={(e) => handleRowClick(entry, e)}
                      onReorder={readOnly ? undefined : reorderField}
                      onRenameLabel={readOnly ? undefined : renameLabel}
                      onMoveOffset={readOnly ? undefined : (dir) => moveFieldByOffset(entry.name, dir)}
                    />
                  ))}
                  {g.entries.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/40 px-3 py-4 text-center text-[11px] text-muted-foreground">
                      {readOnly
                        ? t('designer.canvas.emptySection', locale)
                        : t('designer.canvas.dropHint', locale)}
                    </div>
                  )}
                </GroupSection>
              );
            })}
          </div>
        )}

        {reviewing && diff && diff.removed.length > 0 && (
          <div className="space-y-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-destructive/80 pl-1">
              {t('designer.canvas.diffRemoved', locale)}
            </div>
            {diff.removed.map((entry) => (
              <GhostFieldRow key={entry.name} entry={entry} locale={locale} />
            ))}
          </div>
        )}

        {!emptyState && !readOnly && (
          <div className="flex items-center gap-2 pt-1">
            <AddFieldButton onPick={(type) => addField(type)} locale={locale} />
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={addSection}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t('designer.canvas.addSection', locale)}
            </Button>
            {aiEnabled && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 ml-auto text-primary/80 hover:text-primary"
                onClick={() => requestAssistantOpen()}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('designer.canvas.askAi', locale)}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Review toolbar ─────────────── */

function CanvasToolbar({
  fieldCount,
  requiredCount,
  sectionCount,
  allCollapsed,
  onToggleAll,
  reviewAvailable,
  reviewing,
  diffCounts,
  onToggleReview,
  locale,
}: {
  fieldCount: number;
  requiredCount: number;
  sectionCount: number;
  allCollapsed: boolean;
  onToggleAll?: () => void;
  reviewAvailable?: boolean;
  reviewing?: boolean;
  diffCounts?: { added: number; changed: number; removed: number };
  onToggleReview?: () => void;
  locale?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5 flex-wrap">
        {reviewing && diffCounts ? (
          <>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {diffCounts.added}
            </span>{' '}
            {t('designer.canvas.diffAdded', locale)}
            <span className="text-muted-foreground/50">·</span>
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {diffCounts.changed}
            </span>{' '}
            {t('designer.canvas.diffChanged', locale)}
            <span className="text-muted-foreground/50">·</span>
            <span className="font-medium text-destructive">{diffCounts.removed}</span>{' '}
            {t('designer.canvas.diffRemoved', locale)}
            <span className="text-muted-foreground/40 normal-case ml-1">
              {t('designer.canvas.reviewVsPublished', locale)}
            </span>
          </>
        ) : (
          <>
            <span className="font-medium text-foreground/80">{fieldCount}</span>{' '}
            {t('designer.canvas.fields', locale)}
            <span className="text-muted-foreground/50">·</span>
            <span className="font-medium text-foreground/80">{requiredCount}</span>{' '}
            {t('designer.canvas.required', locale)}
            {sectionCount > 0 && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="font-medium text-foreground/80">{sectionCount}</span>{' '}
                {t('designer.canvas.sections', locale)}
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {reviewAvailable && onToggleReview && (
          <button
            type="button"
            onClick={onToggleReview}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
              reviewing
                ? 'bg-primary/10 text-primary hover:bg-primary/15'
                : 'hover:bg-accent hover:text-foreground',
            )}
          >
            <GitCompareArrows className="h-3 w-3" />
            {reviewing
              ? t('designer.canvas.reviewExit', locale)
              : t('designer.canvas.reviewChanges', locale)}
          </button>
        )}
        {onToggleAll && (
          <button
            type="button"
            onClick={onToggleAll}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-3 w-3" />
            ) : (
              <ChevronsDownUp className="h-3 w-3" />
            )}
            {allCollapsed
              ? t('designer.canvas.expandAll', locale)
              : t('designer.canvas.collapseAll', locale)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Bulk-action bar ─────────────── */

function BulkActionBar({
  count,
  groups,
  onMoveToGroup,
  onDelete,
  onClear,
  locale,
}: {
  count: number;
  groups: ObjectFieldGroup[];
  onMoveToGroup: (groupKey: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
  locale?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-primary/20 bg-primary/10 backdrop-blur px-6 py-2 text-sm">
      <span className="font-medium text-foreground">
        {tFormat('designer.canvas.bulkSelected', locale, { n: count })}
      </span>
      <span className="text-muted-foreground text-[11px] hidden md:inline">
        {t('designer.canvas.bulkHint', locale)}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {groups.length > 0 && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 bg-background/70">
                <FolderInput className="h-3.5 w-3.5" />
                {t('designer.canvas.bulkMoveTo', locale)}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1 max-h-[300px] overflow-auto">
              <button
                type="button"
                onClick={() => { onMoveToGroup(null); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent"
              >
                {t('designer.canvas.ungrouped', locale)}
              </button>
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => { onMoveToGroup(g.key); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent truncate"
                >
                  {g.label || g.key}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 bg-background/70 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('designer.canvas.bulkDelete', locale)}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          {t('designer.canvas.bulkClear', locale)}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────── Building blocks ─────────────── */

function GroupSection({
  groupKey,
  label,
  count,
  showHeader,
  collapsed,
  onToggleCollapse,
  readOnly,
  locale,
  canMoveUp,
  canMoveDown,
  onRename,
  onRemove,
  onMove,
  onAddField,
  onDropField,
  children,
}: {
  groupKey: string | null;
  label: string;
  count: number;
  showHeader: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  readOnly: boolean;
  locale?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Rename/remove/move are only wired for real groups (not Ungrouped). */
  onRename?: (label: string) => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onAddField?: (type: FieldTypeId) => void;
  onDropField?: (fromName: string, groupKey: string | null) => void;
  children: React.ReactNode;
}) {
  const [active, setActive] = React.useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropField) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes('text/x-objectui-field')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // Only deactivate when leaving the section container itself, not its children.
    if (e.currentTarget === e.target) setActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!onDropField) return;
    // Let inner FieldRow drops win — only handle if no row already consumed it.
    if (e.defaultPrevented) { setActive(false); return; }
    e.preventDefault();
    const from = e.dataTransfer.getData('text/x-objectui-field');
    setActive(false);
    if (from) onDropField(from, groupKey);
  };
  return (
    <section
      className={cn(
        'space-y-2.5 rounded-md transition-colors',
        active && 'bg-primary/5 ring-1 ring-primary/30 -mx-1 px-1 py-1',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showHeader && (
        <SectionHeader
          label={label}
          count={count}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          readOnly={readOnly}
          locale={locale}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          dropActive={active}
          onRename={onRename}
          onRemove={onRemove}
          onMove={onMove}
          onAddField={onAddField}
        />
      )}
      {!collapsed && <div className="space-y-2.5">{children}</div>}
    </section>
  );
}

function SectionHeader({
  label,
  count,
  collapsed,
  onToggleCollapse,
  readOnly,
  locale,
  canMoveUp,
  canMoveDown,
  dropActive,
  onRename,
  onRemove,
  onMove,
  onAddField,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  readOnly: boolean;
  locale?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dropActive: boolean;
  onRename?: (label: string) => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onAddField?: (type: FieldTypeId) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(label);
  React.useEffect(() => { setDraft(label); }, [label]);
  const commit = () => {
    if (!onRename) { setEditing(false); return; }
    const next = draft.trim();
    if (next && next !== label) onRename(next);
    setEditing(false);
  };
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="group/sec flex items-center gap-1.5 pl-0.5 min-h-[24px]">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        aria-label={
          collapsed
            ? t('designer.canvas.expandSection', locale)
            : t('designer.canvas.collapseSection', locale)
        }
        aria-expanded={!collapsed}
      >
        <Chevron className="h-3.5 w-3.5" />
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(label); setEditing(false); }
          }}
          onBlur={commit}
          className="text-[11px] font-medium uppercase tracking-wider px-1 py-0.5 -my-0.5 rounded border border-primary bg-background outline-none min-w-0 flex-1 max-w-[220px]"
        />
      ) : (
        <span
          className={cn(
            'text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate',
            onRename && 'cursor-text hover:text-foreground',
          )}
          onDoubleClick={onRename ? () => { setDraft(label); setEditing(true); } : undefined}
          title={onRename ? t('designer.canvas.renameHint', locale) : undefined}
        >
          {label}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{count}</span>
      {dropActive && (
        <span className="text-primary normal-case text-[10px] font-normal">
          {t('designer.canvas.dropToAssign', locale)}
        </span>
      )}

      {/* Section actions — appear on hover, edit-mode only, real groups only. */}
      {!readOnly && (onMove || onRemove || onAddField) && (
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 focus-within:opacity-100 transition-opacity">
          {onAddField && (
            <AddFieldButton onPick={onAddField} compact locale={locale} />
          )}
          {onMove && (
            <>
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={!canMoveUp}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                aria-label={t('designer.canvas.moveSectionUp', locale)}
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={!canMoveDown}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                aria-label={t('designer.canvas.moveSectionDown', locale)}
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('designer.canvas.removeSection', locale)}
              title={t('designer.canvas.removeSectionHint', locale)}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Read-only ghost of a field that exists in the baseline but was removed. */
function GhostFieldRow({ entry, locale }: { entry: FieldEntry; locale?: string }) {
  const def = entry.def;
  const typeStr = typeof def.type === 'string' ? (def.type as string) : 'text';
  const meta = FIELD_TYPE_META[typeStr as FieldTypeId];
  const Icon = meta?.Icon;
  const label = typeof def.label === 'string' ? (def.label as string) : entry.name;
  return (
    <div className="rounded-md border border-dashed border-destructive/30 bg-destructive/[0.03] px-3.5 py-2.5 opacity-80">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
          <span className="text-sm font-medium truncate line-through text-muted-foreground">
            {label}
          </span>
          <code className="text-[10px] text-muted-foreground/60 font-mono truncate line-through">
            {entry.name}
          </code>
        </div>
        <Badge className="text-[10px] font-medium border-transparent bg-destructive/15 text-destructive shrink-0">
          {t('designer.canvas.diffRemoved', locale)}
        </Badge>
      </div>
    </div>
  );
}

function FieldRow({
  entry,
  selected,
  multiSelected,
  diffStatus,
  changedKeys,
  readOnly,
  locale,
  onClick,
  onReorder,
  onRenameLabel,
  onMoveOffset,
}: {
  entry: FieldEntry;
  selected: boolean;
  multiSelected?: boolean;
  /** Review mode: how this field differs from the published baseline. */
  diffStatus?: FieldDiffStatus;
  changedKeys?: string[];
  readOnly: boolean;
  locale?: string;
  /** Receives the mouse event so the host can branch on Ctrl/⌘/Shift. */
  onClick: (e?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void;
  onReorder?: (fromName: string, toName: string, position: 'before' | 'after') => void;
  onRenameLabel?: (name: string, nextLabel: string) => void;
  /** Keyboard reorder (Alt+↑/↓) — swap with same-group neighbour. */
  onMoveOffset?: (dir: -1 | 1) => void;
}) {
  const def = entry.def;
  const typeStr = typeof def.type === 'string' ? (def.type as string) : 'text';
  const meta = FIELD_TYPE_META[typeStr as FieldTypeId];
  const Icon = meta?.Icon;
  const tone = CATEGORY_TONE[meta?.category ?? 'advanced'];
  const label = typeof def.label === 'string' ? (def.label as string) : entry.name;
  const required = !!def.required;
  const description = typeof def.description === 'string' ? (def.description as string) : null;
  const options = Array.isArray(def.options)
    ? (def.options as Array<{ value?: unknown; label?: unknown }>).map((o) => ({
        value: String(o.value ?? ''),
        label: typeof o.label === 'string' ? o.label : undefined,
      }))
    : undefined;
  const referenceTo = typeof def.reference === 'string' ? (def.reference as string) : undefined;
  // Formula source for the ƒ stub: the spec `expression` key (bare string or
  // `{ dialect, source }` envelope), falling back to the legacy `formula`
  // alias still present on unmigrated drafts.
  const exprRaw = def.expression;
  const formula =
    typeof exprRaw === 'string'
      ? exprRaw
      : exprRaw && typeof exprRaw === 'object' && typeof (exprRaw as { source?: unknown }).source === 'string'
        ? (exprRaw as { source: string }).source
        : typeof def.formula === 'string'
          ? (def.formula as string)
          : undefined;
  const placeholder = typeof def.placeholder === 'string' ? (def.placeholder as string) : undefined;

  const [dropZone, setDropZone] = React.useState<'before' | 'after' | null>(null);
  const draggable = !!onReorder;

  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState(label);
  React.useEffect(() => { setLabelDraft(label); }, [label]);
  const beginEdit = (e: React.MouseEvent) => {
    if (!onRenameLabel) return;
    e.preventDefault();
    e.stopPropagation();
    setLabelDraft(label);
    setEditingLabel(true);
  };
  const commitEdit = () => {
    if (!onRenameLabel) { setEditingLabel(false); return; }
    const next = labelDraft.trim();
    if (next && next !== label) onRenameLabel(entry.name, next);
    setEditingLabel(false);
  };
  const cancelEdit = () => {
    setLabelDraft(label);
    setEditingLabel(false);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/x-objectui-field', entry.name);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!draggable) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes('text/x-objectui-field')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    setDropZone(pos);
  };
  const handleDragLeave = () => setDropZone(null);
  const handleDrop = (e: React.DragEvent) => {
    if (!onReorder) return;
    e.preventDefault();
    e.stopPropagation();
    const from = e.dataTransfer.getData('text/x-objectui-field');
    setDropZone(null);
    if (from && from !== entry.name) {
      onReorder(from, entry.name, dropZone ?? 'before');
    }
  };

  return (
    <div
      className={cn('relative', dropZone === 'before' && 'pt-1.5')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropZone === 'before' && (
        <div className="absolute left-0 right-0 -top-0.5 h-0.5 bg-primary rounded-full" />
      )}
      <div
        role="button"
        tabIndex={readOnly ? -1 : 0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            if (onMoveOffset) {
              e.preventDefault();
              onMoveOffset(e.key === 'ArrowUp' ? -1 : 1);
            }
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        }}
        draggable={draggable}
        onDragStart={handleDragStart}
        className={cn(
          'group block w-full text-left rounded-md border bg-card px-3.5 py-2.5 transition-colors',
          'hover:border-primary/40 hover:bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'border-primary ring-2 ring-primary/30 shadow-sm' : 'border-border',
          multiSelected && 'border-primary/60 ring-2 ring-primary/40 bg-primary/[0.04]',
          diffStatus === 'added' && 'border-l-[3px] border-l-emerald-500',
          diffStatus === 'changed' && 'border-l-[3px] border-l-amber-500',
          readOnly && 'cursor-default',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
        aria-pressed={selected || multiSelected}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {multiSelected && (
              <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
            )}
            {draggable && !multiSelected && (
              <GripVertical
                className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground/80"
                aria-hidden="true"
              />
            )}
            {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', tone.icon)} />}
            {editingLabel ? (
              <input
                autoFocus
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                onBlur={commitEdit}
                className="text-sm font-medium px-1 py-0.5 -mx-1 -my-0.5 rounded border border-primary bg-background outline-none min-w-0 flex-1"
              />
            ) : (
              <span
                className={cn('text-sm font-medium truncate', onRenameLabel && 'cursor-text')}
                onDoubleClick={beginEdit}
                title={onRenameLabel ? t('designer.canvas.renameHint', locale) : undefined}
              >
                {label}
              </span>
            )}
            {required && <span className="text-destructive text-sm">*</span>}
            <code className="text-[10px] text-muted-foreground/70 font-mono truncate">{entry.name}</code>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {diffStatus === 'added' && (
              <Badge className="text-[10px] font-medium border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                {t('designer.canvas.diffAdded', locale)}
              </Badge>
            )}
            {diffStatus === 'changed' && (
              <Badge
                className="text-[10px] font-medium border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300"
                title={
                  changedKeys && changedKeys.length
                    ? tFormat('designer.canvas.diffChangedKeys', locale, { keys: changedKeys.join(', ') })
                    : undefined
                }
              >
                {t('designer.canvas.diffChanged', locale)}
              </Badge>
            )}
            <Badge variant="outline" className={cn('text-[10px] font-medium', tone.badge)}>
              {typeLabel(meta, locale) ?? typeStr}
            </Badge>
          </div>
        </div>
        {description && (
          <div className="text-[11px] text-muted-foreground mb-1.5 line-clamp-1">{description}</div>
        )}
        <FieldStub
          type={typeStr}
          label={label}
          placeholder={placeholder}
          options={options}
          referenceTo={referenceTo}
          formula={formula}
          locale={locale}
        />
      </div>
      {dropZone === 'after' && (
        <div className="absolute left-0 right-0 -bottom-1 h-0.5 bg-primary rounded-full" />
      )}
    </div>
  );
}

function EmptyCanvas({
  onAdd,
  locale,
  aiEnabled,
}: {
  onAdd?: (type: FieldTypeId) => void;
  locale?: string;
  /** Show the "Ask AI to generate" affordance only when the runtime serves AI. */
  aiEnabled?: boolean;
}) {
  return (
    <div className="rounded-lg border-2 border-dashed bg-background py-16 px-6 text-center space-y-3">
      <div className="text-sm font-medium">{t('designer.canvas.noFields', locale)}</div>
      <div className="text-xs text-muted-foreground">
        {t('designer.canvas.noFieldsHint', locale)}
      </div>
      {onAdd && (
        <div className="pt-2 flex items-center justify-center gap-2">
          <AddFieldButton onPick={onAdd} locale={locale} />
          {aiEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-primary/80 hover:text-primary"
              onClick={() => requestAssistantOpen()}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('designer.canvas.askAiGenerate', locale)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddFieldButton({ onPick, compact, locale }: { onPick: (type: FieldTypeId) => void; compact?: boolean; locale?: string }) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const q = filter.trim().toLowerCase();

  const groups = React.useMemo(() => {
    if (!q) return TYPES_BY_CATEGORY;
    return TYPES_BY_CATEGORY
      .map((g) => ({
        category: g.category,
        types: g.types.filter((id) => {
          const m = FIELD_TYPE_META[id];
          // Match the id, the English label, and the label as the user
          // actually sees it — previously the third arm was hard-wired to
          // Chinese, so searching in ja/de matched nothing (objectui#2871).
          const shown = typeLabel(m, locale) ?? '';
          return id.includes(q) || m.label.toLowerCase().includes(q) || shown.toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.types.length > 0);
  }, [q, filter]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFilter('');
      }}
    >
      <PopoverTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('designer.canvas.addFieldToSection', locale)}
            title={t('designer.canvas.addFieldToSection', locale)}
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 border-dashed">
            <Plus className="h-3.5 w-3.5" />
            {t('designer.canvas.addField', locale)}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0 max-h-[480px] overflow-hidden flex flex-col">
        <div className="p-2 border-b">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('designer.canvas.searchFieldType', locale)}
            className="h-7 w-full px-2 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex-1 overflow-auto p-1">
          {groups.length === 0 ? (
            <div className="text-xs text-muted-foreground p-4 text-center">
              {t('designer.canvas.noMatchingTypes', locale)}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.category} className="mb-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1">
                  {categoryLabel(g.category, locale)}
                </div>
                <div className="grid grid-cols-2 gap-0.5">
                  {g.types.map((id) => {
                    const m = FIELD_TYPE_META[id];
                    const Icon = m.Icon;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          onPick(id);
                          setOpen(false);
                          setFilter('');
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-accent"
                      >
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', CATEGORY_TONE[m.category].icon)} />
                        <span className="truncate">{typeLabel(m, locale)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Internal helper for callers that want to normalize a name in their own UI.
export { toFieldName };

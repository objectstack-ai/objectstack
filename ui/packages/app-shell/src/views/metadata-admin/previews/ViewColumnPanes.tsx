// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compact controls for the View column bar.
 *
 *   • ColumnChip      — a single draggable column "pill": click to
 *     select (→ inspector), drag to reorder, × to remove. Designed to
 *     sit in a one-line toolbar above the live grid preview so the
 *     preview — not the field manager — owns the canvas.
 *
 *   • AddFieldPopover — an Airtable/Notion-style "+ Add field" button
 *     that opens a searchable checklist of the bound Object's fields.
 *     Click a field to append it as a column. Already-used fields are
 *     tagged "Added" but stay clickable (a table may show a field
 *     twice). Removal is explicit via the chip × so column-level config
 *     (label, width, sortable…) is never silently dropped.
 */

import * as React from 'react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import { resolveFieldTypeMeta, resolveCategoryTone } from './field-types.js';
import type { ObjectFieldInfo } from './useObjectFields.js';
import { useMetadataLocale, t, tFormat } from '../i18n.js';
import { DraftChip } from '../../studio-design/StudioDraftMark.js';

const DND_MIME = 'text/x-objectui-viewcol';

function FieldIcon({ type }: { type: unknown }) {
  const meta = resolveFieldTypeMeta(type);
  const tone = resolveCategoryTone(type);
  const Icon = meta.Icon;
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${tone.icon}`} />;
}

/* ───────────────────────────── Column chip ────────────────────────────── */

export function ColumnChip({
  index,
  label,
  fieldType,
  selected,
  canEdit,
  dragging,
  dropBefore,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOverChip,
  onDropChip,
}: {
  index: number;
  label: string;
  fieldType: unknown;
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverChip: () => void;
  onDropChip: () => void;
}) {
  return (
    <div className="relative flex items-stretch">
      {dropBefore && (
        <span className="pointer-events-none absolute -left-1 top-0 h-full w-0.5 rounded bg-primary" />
      )}
      <div
        role="button"
        tabIndex={0}
        draggable={canEdit}
        aria-pressed={selected}
        onDragStart={(e) => {
          if (!canEdit) return;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DND_MIME, String(index));
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!canEdit || !dragging) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOverChip();
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          onDropChip();
        }}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={
          'group inline-flex items-center gap-1.5 rounded-md border bg-card py-1 pl-1.5 pr-1 text-xs transition-colors hover:border-primary/40 ' +
          (selected ? 'border-primary ring-1 ring-primary' : 'border-border') +
          (canEdit ? ' cursor-grab active:cursor-grabbing' : '')
        }
      >
        {canEdit && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
        )}
        <FieldIcon type={fieldType} />
        <span className="max-w-[12rem] truncate font-medium">{label}</span>
        {canEdit && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Field list row (vertical) ──────────────────── */

/**
 * FieldListRow — a full-width, vertically-stacked variant of {@link ColumnChip}
 * for the right-panel Fields list. Same HTML5 drag-and-drop contract (click to
 * select, drag the handle to reorder, × to remove) but laid out as a list row
 * (icon · label · machine name · remove) so it reads like a mainstream
 * low-code field manager rather than a horizontal toolbar.
 */
export function FieldListRow({
  index,
  label,
  fieldName,
  fieldType,
  selected,
  canEdit,
  dragging,
  dropBefore,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDropRow,
  copilotAdded,
}: {
  index: number;
  label: string;
  fieldName?: string;
  fieldType: unknown;
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: () => void;
  onDropRow: () => void;
  /**
   * objectui#12725 — the AI copilot added this column in the pending draft:
   * the row carries the copilot's draft chip. Absent, the row is unchanged.
   */
  copilotAdded?: boolean;
}) {
  // The designer locale, read as this file's `AddFieldPopover` reads it
  // (objectui#10862): both hosts (`FieldsListEditor`, `ReportDefaultInspector`)
  // render the popover beside these rows.
  const locale = useMetadataLocale();
  return (
    <div className="relative">
      {dropBefore && (
        <span className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 rounded bg-primary" />
      )}
      <div
        role="button"
        tabIndex={0}
        draggable={canEdit}
        aria-pressed={selected}
        onDragStart={(e) => {
          if (!canEdit) return;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DND_MIME, String(index));
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!canEdit || !dragging) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOverRow();
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          onDropRow();
        }}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={
          'group flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs transition-colors hover:border-primary/40 ' +
          (selected ? 'border-primary ring-1 ring-primary ' : 'border-border ') +
          (canEdit ? 'cursor-grab active:cursor-grabbing' : '')
        }
      >
        {canEdit && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
        )}
        <FieldIcon type={fieldType} />
        {/* objectui#12693 — a row that reads a label keeps its field name
            reachable on hover as well as in the secondary text beside it. */}
        <span
          className="min-w-0 flex-1 truncate font-medium"
          title={fieldName && fieldName !== label ? fieldName : undefined}
        >
          {label}
        </span>
        {copilotAdded && (
          <DraftChip locale={locale} testId="studio-draft-element-chip" of={fieldName} />
        )}
        {fieldName && fieldName !== label && (
          <code className="max-w-[7rem] shrink-0 truncate text-[10px] text-muted-foreground">
            {fieldName}
          </code>
        )}
        {canEdit && (
          <span
            role="button"
            tabIndex={0}
            aria-label={tFormat('engine.viewColumnPanes.remove', locale, { label })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Add-field popover ────────────────────────── */

export function AddFieldPopover({
  fields,
  usedNames,
  loading,
  error,
  onAdd,
}: {
  fields: ObjectFieldInfo[];
  usedNames: Set<string>;
  loading: boolean;
  error: string | null;
  onAdd: (field: ObjectFieldInfo) => void;
}) {
  const locale = useMetadataLocale();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q),
    );
  }, [fields, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:bg-accent/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> {t('engine.form.addFieldPlain', locale)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('engine.form.searchFields', locale)}
            className="h-8 w-full rounded border border-input bg-background pl-7 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {loading ? (
            <Hint>{t('engine.form.loadingFields', locale)}</Hint>
          ) : error ? (
            <Hint tone="warn">{tFormat('engine.form.noObjectFields', locale, { error })}</Hint>
          ) : filtered.length === 0 ? (
            <Hint>{query ? t('engine.form.noMatchingFields', locale) : t('engine.form.noFieldsOnObject', locale)}</Hint>
          ) : (
            filtered.map((f) => {
              const used = usedNames.has(f.name);
              return (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => onAdd(f)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <FieldIcon type={f.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.label}</span>
                  {f.name !== f.label && (
                    <code className="max-w-[6rem] truncate text-[10px] text-muted-foreground">
                      {f.name}
                    </code>
                  )}
                  {used && (
                    <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                      {t('engine.form.added', locale)}
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      className={
        'px-2 py-4 text-center text-[11px] ' +
        (tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  );
}

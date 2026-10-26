// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FieldsListEditor — the right-panel column manager (mainstream low-code
 * pattern: a vertical, drag-reorderable list of fields with an inline
 * "+ Add field" picker).
 *
 * This is the SINGLE owner of column read / write / reorder / remove / select
 * logic for a View variant. It is rendered in two places so the fields list is
 * always visible:
 *   • {@link ViewVariantInspector} (the home / variant panel) — no row is
 *     highlighted; clicking a row drills into the scoped column inspector.
 *   • {@link ViewColumnInspector} (the scoped column panel) — the selected row
 *     is highlighted and the column's detail props render below it.
 *
 * Columns round-trip in their original shape: string variants (e.g. kanban
 * card fields) stay strings; object variants keep `{ field, label, … }`. The
 * raw `columns` array is reordered / spliced directly — never normalised — so
 * round-trips stay lossless.
 */

import * as React from 'react';
import { Badge, Label } from '@object-ui/components';
import { appendArray, moveArray, spliceArray } from '../inspectors/_shared.js';
import { useObjectFields, type ObjectFieldInfo } from './useObjectFields.js';
import { AddFieldPopover, FieldListRow } from './ViewColumnPanes.js';
import {
  colFieldName,
  colLabel,
  makeColumn,
  remapIndexAfterMove,
  remapIndexAfterRemove,
  usedFieldNames,
} from './view-column-io.js';
import { useMetadataLocale, t, tFormat } from '../i18n.js';

/** A column's label, its positional fallback (`col N`) read in the designer locale (objectui#10862). */
function labelOf(c: unknown, i: number, locale: string): string {
  return colLabel(c, i, (n) => tFormat('engine.fieldsListEditor.colN', locale, { n }));
}

export interface FieldsListEditorProps {
  /** Top-level variant key the columns belong to (e.g. 'list'). */
  variantKey: string;
  /** The variant schema; re-spread on every column write. */
  schema: Record<string, unknown>;
  /** Raw columns array (entries may be strings or objects). */
  columns: unknown[];
  /** Whether every column is a bare string (drives new-column shape). */
  allStrings: boolean;
  /** Bound object name — drives field icons + the Add-field picker. */
  objectName?: string;
  /**
   * Pre-resolved field catalog. When supplied, skips the network fetch and
   * uses this list instead (host already holds the object definition).
   */
  objectFieldsOverride?: ObjectFieldInfo[];
  /** Index of the currently selected column, or null when none. */
  selectedIndex: number | null;
  /** Read-only mode disables drag / add / remove. */
  readOnly?: boolean;
  /** Apply a shallow patch to the draft. */
  onPatch: (patch: Record<string, unknown>) => void;
  /** Emit / redirect the column selection. */
  onSelectionChange?: (
    sel: { kind: string; id: string; label?: string } | null,
  ) => void;
  /**
   * objectui#12725 — the field names of the columns the AI copilot added in the
   * pending draft: each such row carries the copilot's draft chip. Absent, no
   * row is marked.
   */
  copilotAdded?: ReadonlySet<string>;
}

export function FieldsListEditor({
  variantKey,
  schema,
  columns,
  allStrings,
  objectName,
  objectFieldsOverride,
  selectedIndex,
  readOnly,
  onPatch,
  onSelectionChange,
  copilotAdded,
}: FieldsListEditorProps) {
  const canEdit = !readOnly;
  // The designer locale, read the way this editor's add-field popover
  // (`AddFieldPopover`) and rows (`FieldListRow`) read it (objectui#10862):
  // its hosts, the view and report inspectors, hold the same hook's value.
  const locale = useMetadataLocale();
  const { fields, loading, error } = useObjectFields(
    objectName || undefined,
    objectFieldsOverride,
  );

  const fieldTypeByName = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fields) m.set(f.name, f.type);
    return m;
  }, [fields]);

  // objectui#12693 — a row names its column by the bound field's label when
  // the column carries none of its own: a bare-string column stores only the
  // field name, and the catalog above holds that field's label. The stored
  // `columns` stay names; only the drawn text reads the label, and a name the
  // catalog does not know stays the text.
  const fieldLabelByName = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fields) if (f.label && f.label.trim()) m.set(f.name, f.label);
    return m;
  }, [fields]);
  const rowLabelOf = (c: unknown, i: number): string => {
    const own = c && typeof c === 'object' ? (c as Record<string, unknown>).label : undefined;
    if (own != null) return labelOf(c, i, locale);
    return fieldLabelByName.get(colFieldName(c) ?? '') ?? labelOf(c, i, locale);
  };

  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);

  const writeColumns = React.useCallback(
    (next: unknown[]) => {
      onPatch({ [variantKey]: { ...schema, columns: next } });
    },
    [onPatch, variantKey, schema],
  );

  const addField = React.useCallback(
    (field: ObjectFieldInfo) => {
      const col = makeColumn(allStrings, field.name, field.label);
      const next = appendArray(columns, col);
      writeColumns(next);
      onSelectionChange?.({
        kind: 'column',
        id: `${variantKey}.columns[${next.length - 1}]`,
        label: field.label,
      });
    },
    [allStrings, columns, writeColumns, variantKey, onSelectionChange],
  );

  const removeColumn = React.useCallback(
    (index: number) => {
      const next = spliceArray(columns, index, null);
      writeColumns(next);
      if (selectedIndex != null) {
        const remapped = remapIndexAfterRemove(selectedIndex, index);
        if (remapped == null) onSelectionChange?.(null);
        else
          onSelectionChange?.({
            kind: 'column',
            id: `${variantKey}.columns[${remapped}]`,
            label: labelOf(next[remapped], remapped, locale),
          });
      }
    },
    [columns, writeColumns, selectedIndex, variantKey, onSelectionChange, locale],
  );

  const moveColumn = React.useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = moveArray(columns, from, to);
      writeColumns(next);
      if (selectedIndex != null) {
        const remapped = remapIndexAfterMove(selectedIndex, from, to);
        onSelectionChange?.({
          kind: 'column',
          id: `${variantKey}.columns[${remapped}]`,
          label: labelOf(next[remapped], remapped, locale),
        });
      }
    },
    [columns, writeColumns, selectedIndex, variantKey, onSelectionChange, locale],
  );

  const selectColumn = React.useCallback(
    (index: number) => {
      onSelectionChange?.({
        kind: 'column',
        id: `${variantKey}.columns[${index}]`,
        label: labelOf(columns[index], index, locale),
      });
    },
    [columns, variantKey, onSelectionChange, locale],
  );

  const usedNames = usedFieldNames(columns);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{t('engine.fieldsListEditor.columns', locale)}</Label>
        <Badge variant="outline" className="text-[10px]">
          {columns.length}
        </Badge>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-center text-[11px] text-muted-foreground">
          {t('engine.fieldsListEditor.empty', locale)}
        </p>
      ) : (
        <div className="space-y-1">
          {columns.map((c, i) => (
            <FieldListRow
              key={i}
              index={i}
              label={rowLabelOf(c, i)}
              fieldName={colFieldName(c)}
              copilotAdded={copilotAdded?.has(colFieldName(c) ?? '')}
              fieldType={fieldTypeByName.get(colFieldName(c) ?? '') ?? 'text'}
              selected={selectedIndex === i}
              canEdit={canEdit}
              dragging={dragIndex !== null}
              dropBefore={overIndex === i && dragIndex !== null && dragIndex !== i}
              onSelect={() => selectColumn(i)}
              onRemove={() => removeColumn(i)}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOverRow={() => setOverIndex(i)}
              onDropRow={() => {
                if (dragIndex != null && dragIndex !== i) moveColumn(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <AddFieldPopover
          fields={fields}
          usedNames={usedNames}
          loading={loading}
          error={error}
          onAdd={addField}
        />
      )}
    </div>
  );
}

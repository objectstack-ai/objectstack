// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ViewColumnInspector — scoped editor for the selected View column.
 *
 * Selection shape:  { kind: 'column', id: '<variant>.columns[<i>]' }
 *
 * SPEC-DRIVEN: the column's detail properties (width / align / pinned /
 * summary / sortable / …) are rendered from the spec's `ListColumn`
 * JSONSchema via the generic {@link SchemaForm}, NOT a hardcoded field
 * list. New ListColumn props in `@objectstack/spec` appear automatically.
 *
 * A thin curated layer stays on top for the column IDENTITY (field key +
 * label), and it reads that identity in the ObjectStack canonical spelling
 * `{ field, label }` ONLY. The legacy TanStack spelling `{ accessorKey,
 * header }` is not an identity this editor understands: `ListColumn` refuses
 * both keys by name, so a column carrying them has no field key as far as the
 * spec is concerned — and the inspector now shows exactly that (an empty field
 * key) rather than dressing a refused key up as a valid identity. Retiring
 * that read is objectui#5344; the WRITE path is deliberately untouched, so
 * editing such a column still re-saves the spelling it was handed and no
 * stored document is rewritten. A column that is a bare string (e.g. a kanban
 * card field) is kept as a string until the author edits a detail prop.
 */

import * as React from 'react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t } from '../i18n.js';
import {
  InspectorShell,
  InspectorReorderButtons,
  InspectorTextField,
  InspectorSelectField,
  InspectorRemoveButton,
  InspectorEmptyState,
  flagUnknownValue,
  rosterFrom,
  spliceArray,
  moveArray,
} from './_shared.js';
import { SchemaForm } from '../SchemaForm.js';
import { getListColumnSchema } from '../view-schema.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { FieldsListEditor } from '../previews/FieldsListEditor.js';

interface ViewColumn {
  // ObjectStack canonical shape
  field?: string;
  label?: string;
  // TanStack-style shape (legacy/imported tables). Preserved on write by
  // `patchIdentity`, never read as the column's identity — see `colFieldKey`.
  accessorKey?: string;
  header?: string;
  [k: string]: unknown;
}

/**
 * Keys the curated layer owns — hidden from the spec form, and not counted as
 * detail props by {@link hasDetailProps}.
 *
 * `accessorKey` / `header` stay listed even though the identity read below no
 * longer consults them, because neither reader of this list asks "what is this
 * column's identity?":
 *
 *   - {@link hasDetailProps} asks whether collapsing an object back to a bare
 *     string would lose anything. Listing the legacy keys keeps that guard
 *     conservative, and dropping them would change what {@link writeColumns}
 *     serializes — the write path objectui#5344 rules out of scope.
 *   - `hiddenFields` asks which SPEC-DECLARED properties the curated layer
 *     already renders, and `ListColumn` declares neither key, so those two
 *     entries can never match anything there.
 */
const IDENTITY_KEYS = ['field', 'label', 'accessorKey', 'header'];

function parseId(id: string): { variant: string; index: number } | null {
  const m = /^([a-zA-Z_][\w]*)\.columns\[(\d+)\]$/.exec(id);
  if (!m) return null;
  return { variant: m[1], index: Number(m[2]) };
}

/** Read a column entry — handles object shape AND raw string shape (kanban). */
function readColumn(raw: unknown): ViewColumn {
  if (typeof raw === 'string') return { field: raw };
  if (raw && typeof raw === 'object') return raw as ViewColumn;
  return {};
}

/**
 * The column's field key, read in the canonical spelling ONLY.
 *
 * `c.accessorKey` is deliberately not consulted. `ListColumn` refuses that key
 * by name (`unrecognized_keys`), so a column carrying it has no field key the
 * spec recognises; reading it here would present a refused spelling as a valid
 * identity — the same consumer-side tolerance alias `ObjectGrid` retired in
 * objectui#5068, surviving one layer up in the authoring tool, which is the
 * surface that is supposed to teach the correct shape. A legacy column
 * therefore shows an EMPTY field key and the author re-authors it
 * (objectui#5344; objectui#5349's renderer diagnostic does the telling).
 */
function colFieldKey(c: ViewColumn): string {
  return c.field ?? '';
}

/** The column's display label — canonical `label` only, same rule as above. */
function colDisplayLabel(c: ViewColumn): string {
  return c.label ?? colFieldKey(c);
}

/** Does the object carry any detail prop beyond its identity keys? */
function hasDetailProps(c: ViewColumn): boolean {
  return Object.keys(c).some((k) => !IDENTITY_KEYS.includes(k));
}

/** Resolve the object a variant is bound to (drives field loading). */
function readVariantObject(v: Record<string, unknown> | undefined): string {
  if (!v) return '';
  const data = v.data as Record<string, unknown> | undefined;
  if (data && typeof data.object === 'string') return data.object;
  if (typeof v.object === 'string') return v.object;
  return '';
}

export function ViewColumnInspector({
  selection,
  draft,
  onPatch,
  onClearSelection,
  onSelectionChange,
  locale,
  readOnly,
}: MetadataInspectorProps) {
  const parsed = parseId(selection.id);
  const variantSchema = parsed
    ? ((draft as any)[parsed.variant] as Record<string, unknown> | undefined)
    : undefined;
  const rawColumns: unknown[] =
    parsed && Array.isArray(variantSchema?.columns)
      ? (variantSchema!.columns as unknown[])
      : [];
  const columns: ViewColumn[] = rawColumns.map(readColumn);
  const col = parsed ? columns[parsed.index] ?? null : null;
  const isStringColumn = parsed
    ? typeof rawColumns[parsed.index] === 'string'
    : false;

  const columnSchema = React.useMemo(() => getListColumnSchema(), []);

  // Load the bound object's field catalog so the column's field key is a
  // proper picker (dropdown of real fields) instead of a free-text box.
  const objectName = readVariantObject(variantSchema);
  const {
    fields: objectFields,
    loading: fieldsLoading,
    error: fieldsError,
  } = useObjectFields(objectName || undefined);
  const currentFieldKey = col ? colFieldKey(col) : '';
  const fieldOptions = React.useMemo(
    () =>
      objectFields.map((f) => ({
        value: f.name,
        label: f.label && f.label !== f.name ? `${f.label} · ${f.name}` : f.name,
      })),
    [objectFields],
  );
  // Keeping the current value visible when it isn't a known object field
  // (computed / virtual / stale columns) is `InspectorSelectField`'s rule since
  // objectui#8488 — this file only keeps the WORDING. What it does still own is
  // a different question the synthesized row used to answer as a side effect:
  // picker or free-text box? The old gate was `fieldOptions.length > 0` with
  // the synthesized row already spliced in, which is true exactly when the
  // catalog has rows OR a key is stored — spelled out here so removing the
  // splice does not silently move that decision.
  const showFieldPicker = fieldOptions.length > 0 || currentFieldKey !== '';

  if (!parsed || !col) {
    return (
      <InspectorShell
        kindLabel={t('engine.inspector.viewColumn.kind', locale)}
        title={selection.label ?? selection.id}
        onClose={onClearSelection}
        closeLabel={t('engine.inspector.viewColumn.close', locale)}
      >
        <InspectorEmptyState message={selection.id} />
      </InspectorShell>
    );
  }

  /** Write the column array back, preserving string shape when lossless. */
  const writeColumns = (next: ViewColumn[]) => {
    const serialized = next.map((c, i) => {
      const wasString = typeof rawColumns[i] === 'string';
      const fieldKey = colFieldKey(c);
      if (wasString && !hasDetailProps(c) && !c.label && !c.header && fieldKey) {
        return fieldKey;
      }
      return c;
    });
    onPatch({ [parsed.variant]: { ...variantSchema, columns: serialized } });
  };

  /** Patch identity (field/label) honouring whichever shape is in use. */
  const patchIdentity = (updates: Partial<ViewColumn>) => {
    const targetField = 'field' in col || !('accessorKey' in col) ? 'field' : 'accessorKey';
    const targetLabel = 'label' in col || !('header' in col) ? 'label' : 'header';
    const remapped: Partial<ViewColumn> = { ...updates };
    if ('field' in updates) {
      remapped[targetField] = updates.field;
      if (targetField !== 'field') delete remapped.field;
    }
    if ('label' in updates) {
      remapped[targetLabel] = updates.label;
      if (targetLabel !== 'label') delete remapped.label;
    }
    writeColumns(spliceArray(columns, parsed.index, { ...col, ...remapped }));
  };

  /** Whole-column write from the spec detail form. */
  const writeDetail = (next: Record<string, unknown>) => {
    writeColumns(spliceArray(columns, parsed.index, next as ViewColumn));
  };

  const remove = () => {
    writeColumns(spliceArray(columns, parsed.index, null));
    onClearSelection();
  };

  const move = (to: number) => {
    writeColumns(moveArray(columns, parsed.index, to));
    onSelectionChange?.({
      kind: 'column',
      id: `${parsed.variant}.columns[${to}]`,
      label: colDisplayLabel(col) || `columns[${to}]`,
    });
  };

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.viewColumn.kind', locale)}
      title={colDisplayLabel(col) || selection.id}
      onClose={onClearSelection}
      closeLabel={t('engine.inspector.viewColumn.close', locale)}
      headerActions={
        <InspectorReorderButtons
          index={parsed.index}
          total={columns.length}
          onMove={move}
          upLabel={t('engine.inspector.reorder.up', locale)}
          downLabel={t('engine.inspector.reorder.down', locale)}
          disabled={readOnly}
        />
      }
      footer={
        <InspectorRemoveButton
          label={t('engine.inspector.viewColumn.remove', locale)}
          onClick={remove}
          disabled={readOnly}
        />
      }
    >
      {variantSchema && (
        <div className="pb-1">
          <FieldsListEditor
            variantKey={parsed.variant}
            schema={variantSchema}
            columns={rawColumns}
            allStrings={
              rawColumns.length > 0 &&
              rawColumns.every((c) => typeof c === 'string')
            }
            objectName={objectName || undefined}
            selectedIndex={parsed.index}
            readOnly={readOnly}
            onPatch={onPatch}
            onSelectionChange={onSelectionChange}
          />
        </div>
      )}

      <div className="border-t pt-3 space-y-3">
        {showFieldPicker ? (
          <InspectorSelectField
            label={t('engine.inspector.viewColumn.accessorKey', locale)}
            value={colFieldKey(col)}
            options={fieldOptions}
            unknownValueLabel={(v) =>
              flagUnknownValue(v, t('engine.form.notInObject', locale), locale)
            }
            // objectui#8862 — `useObjectFields` answers over the network, and
            // until it does `fieldOptions` is `[]`. Without this the marker
            // above told the author, for the length of that round trip, that a
            // column bound to a REAL field of this object is not on it. The
            // hook already publishes the signal; the flag is withheld until the
            // roster can actually testify.
            //
            // objectui#9651 — the hook publishes a THIRD fact, `error`, and
            // dropping it on the floor is what made the same false marker
            // PERMANENT after a failed fetch instead of transient. It is passed
            // as one state rather than a second flag, so the two can never be
            // read in the wrong order or in an impossible combination.
            roster={rosterFrom({ loading: fieldsLoading, error: fieldsError })}
            rosterFailureLabel={t('engine.form.optionsLoadFailedTitle', locale)}
            onCommit={(v) => patchIdentity({ field: v })}
            disabled={readOnly}
          />
        ) : (
          <InspectorTextField
            label={t('engine.inspector.viewColumn.accessorKey', locale)}
            value={colFieldKey(col)}
            onCommit={(v) => patchIdentity({ field: v })}
            disabled={readOnly}
            mono
          />
        )}
        <InspectorTextField
          label={t('engine.inspector.viewColumn.header', locale)}
          value={colDisplayLabel(col) === colFieldKey(col) ? '' : colDisplayLabel(col)}
          onCommit={(v) => patchIdentity({ label: v })}
          disabled={readOnly}
        />

        {!isStringColumn && columnSchema ? (
          <div className="border-t pt-3">
            <SchemaForm
              schema={columnSchema}
              value={col as Record<string, unknown>}
              hiddenFields={IDENTITY_KEYS}
              readOnly={readOnly}
              onChange={writeDetail}
            />
          </div>
        ) : null}
      </div>
    </InspectorShell>
  );
}

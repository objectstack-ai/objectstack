/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE place that decides whether an authored `columns[i]` becomes a data
 * column — and the diagnostic that says so out loud when it does not
 * (objectui#5349, the Q2 objectui#5068 deferred).
 *
 * ## Why this file exists
 *
 * objectui#5068 retired `ObjectGrid`'s undeclared `accessorKey` / `header`
 * tolerance branch, so `ListColumnSchema`'s `field` / `label` is now the only
 * spelling the renderer reads. That is right — `ListColumnSchema`
 * (`@objectstack/spec/ui`) is a STRICT object that refuses `accessorKey` and
 * `header` BY NAME, and the census behind #5068 found zero authored
 * `accessorKey`-shaped `object-grid` columns.
 *
 * But it RELOCATED a failure mode instead of removing it: a column authored in
 * a spelling the renderer does not read now contributes nothing, and nothing
 * said so — no error, no warning, no empty header. The author got a grid with
 * its row-number column and no data columns, i.e. a success receipt for a
 * disagreement between the renderer and the author. That is the same shape
 * #5068 exists to fix, one level down.
 *
 * ## What is diagnosed — and what deliberately is not
 *
 * The predicate here is about the `columns` INPUT only. It never asks whether
 * the grid found rows, because "this grid has no columns" is a question with
 * legitimate answers: a grid with no `columns` at all auto-derives them from
 * the object schema or the first inline row, and a grid can draw its rows from
 * five different places (`data` array, `data.provider: 'value'`, legacy
 * `staticData`, `bind`, or a HOST that owns the fetch and passes the window
 * down as a `data` React prop — `plugin-list`'s `ListView` does exactly that).
 * A "needs columns" predicate that consulted any of those would paint a
 * configuration error over a working grid, which is worse than the silence it
 * replaces. So the question asked here is strictly the local one:
 *
 *   the author WROTE this column entry, and it can never resolve — say which
 *   one, what it spells, and what the declared spelling is.
 *
 * `hidden: true` is authored intent, not a defect, so a hidden column is
 * counted apart and never reported — including a hidden column that also
 * mis-spells its identity, which contributes nothing either way.
 *
 * ## Why a console warning, and only a console warning
 *
 * `ObjectGrid` already has exactly one channel for "you declared something and
 * the renderer dropped it": the export-format warning in `ObjectGrid.tsx`
 * (`[ObjectUI] ObjectGrid export: unsupported format(s) hidden from the
 * menu…`) — a `useEffect` keyed on the schema slice, one `console.warn`, no
 * NODE_ENV branch. This diagnostic is deliberately the SAME shape rather than
 * a second, differently-shaped one next to it (objectui#5349's own warning
 * about that). Rendering a visible in-grid message instead would be
 * user-facing copy, which needs all ten locale packs in `@object-ui/i18n` —
 * outside this card's file surface — and a throw would take the whole
 * surrounding page down for a defect that today costs one grid.
 */

/** The declared column-identity key — `ListColumnSchema.field`. */
export const DECLARED_COLUMN_FIELD_KEY = 'field';
/** The declared column-header key — `ListColumnSchema.label`. */
export const DECLARED_COLUMN_LABEL_KEY = 'label';

/**
 * Keys the spec refuses BY NAME and this renderer no longer reads. `accessorKey`
 * is not a typo — it is the data-table ADAPTER's key on the way OUT (see
 * `TABLE_ADAPTER_COLUMN_KEY` in `@object-ui/core`), which is exactly why it
 * reads as plausible authoring vocabulary on the way IN.
 */
const RETIRED_COLUMN_KEYS = ['accessorKey', 'header'] as const;

/**
 * Does this authored entry become a data column?
 *
 * This is the renderer's own filter, extracted so the diagnostic below and
 * `ObjectGrid`'s `generateColumns` cannot drift apart: one predicate, two
 * readers. Semantics are unchanged from the inline filter it replaces —
 * `col?.field && typeof col.field === 'string' && !col.hidden`.
 */
export function resolvesToDataColumn(col: unknown): boolean {
  if (!col || typeof col !== 'object') return false;
  const entry = col as Record<string, unknown>;
  if (entry.hidden) return false;
  return typeof entry.field === 'string' && entry.field.length > 0;
}

/** Is this entry suppressed on purpose rather than broken? */
function isDeliberatelyHidden(col: unknown): boolean {
  return !!col && typeof col === 'object' && !!(col as Record<string, unknown>).hidden;
}

/** One authored entry that can never resolve, and why. */
export interface UnresolvedAuthoredColumn {
  /** Index in the authored `columns` array — the address. */
  index: number;
  /** What the entry spells, and the rewrite that would work. */
  detail: string;
}

export interface AuthoredColumnPartition {
  /** Entries that become data columns. */
  resolved: number;
  /** Entries suppressed by `hidden: true` — authored intent, never reported. */
  hidden: number;
  /** Entries that can never resolve, each with its address. */
  unresolved: UnresolvedAuthoredColumn[];
}

function quote(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/** Describe ONE unresolved entry: what it spells, and what to write instead. */
function describeEntry(col: unknown): string {
  if (col === null || col === undefined) {
    return `the entry is ${String(col)}, not a column object`;
  }
  if (typeof col !== 'object') {
    return `the entry is a ${typeof col} (${quote(col)}), not a column object — a `
      + `bare field name only works when EVERY entry is a string (\`columns: ['name', 'amount']\`)`;
  }
  const entry = col as Record<string, unknown>;
  const keys = Object.keys(entry);
  const retired = RETIRED_COLUMN_KEYS.filter((k) => k in entry);
  const seen = keys.length > 0 ? `keys seen: ${keys.map((k) => `\`${k}\``).join(', ')}` : 'the entry is empty `{}`';

  if (retired.length > 0) {
    const accessor = entry.accessorKey;
    const header = entry.header;
    const rewrite = typeof accessor === 'string' && accessor.length > 0
      ? ` Write \`{ ${DECLARED_COLUMN_FIELD_KEY}: '${accessor}'`
        + `${typeof header === 'string' && header.length > 0 ? `, ${DECLARED_COLUMN_LABEL_KEY}: '${header}'` : ''} }\` instead.`
      : '';
    return `${seen} — ${retired.map((k) => `\`${k}\``).join(' / ')} `
      + `${retired.length > 1 ? 'are' : 'is'} refused by name and not read here.${rewrite}`;
  }
  if (!(DECLARED_COLUMN_FIELD_KEY in entry)) {
    return `${seen} — no \`${DECLARED_COLUMN_FIELD_KEY}\` key, so the column names no field.`;
  }
  const field = entry[DECLARED_COLUMN_FIELD_KEY];
  if (typeof field !== 'string') {
    return `${seen} — \`${DECLARED_COLUMN_FIELD_KEY}\` is a ${field === null ? 'null' : typeof field} `
      + `(${quote(field)}), and only a non-empty string names a field.`;
  }
  if (field.length === 0) {
    return `${seen} — \`${DECLARED_COLUMN_FIELD_KEY}\` is an empty string, so the column names no field.`;
  }
  // Unreachable while `hidden` is judged before this function is called (it is,
  // in `partitionAuthoredColumns`) — a non-empty string `field` is exactly what
  // `resolvesToDataColumn` accepts. Kept explicit anyway: this line used to be
  // the `field.length === 0` message with no length check under it, so removing
  // the `hidden` carve-out made the diagnostic tell a well-formed column that
  // its `field` was "an empty string". A message must never assert something it
  // did not check. (Found by the objectui#5349 reverse-verification.)
  return `${seen} — \`${DECLARED_COLUMN_FIELD_KEY}\` is '${field}', and the column still did not resolve.`;
}

/**
 * Split an authored `columns` array into resolved / hidden / unresolved.
 *
 * Returns `null` when there is nothing to judge — no `columns`, an empty
 * `columns`, or the `string[]` spelling (whose own arm in `generateColumns`
 * filters non-strings and is not this card's failure mode).
 */
export function partitionAuthoredColumns(columns: unknown): AuthoredColumnPartition | null {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  // `normalizeColumns` dispatches the whole array on its first entry, so a
  // `string[]` list is the string arm — judged there, not here.
  if (typeof columns[0] !== 'object' || columns[0] === null) return null;

  const partition: AuthoredColumnPartition = { resolved: 0, hidden: 0, unresolved: [] };
  columns.forEach((col, index) => {
    if (resolvesToDataColumn(col)) partition.resolved += 1;
    else if (isDeliberatelyHidden(col)) partition.hidden += 1;
    else partition.unresolved.push({ index, detail: describeEntry(col) });
  });
  return partition;
}

/** Where the offending block lives, for the first line of the message. */
export interface GridColumnAddress {
  /** The schema node's `type` — `object-grid`, or the `view:grid` alias. */
  blockType?: unknown;
  /** The object the grid queries, when it names one. */
  objectName?: unknown;
  /** The grid's authored label, when it has one — often the only human name. */
  label?: unknown;
}

function describeAddress({ blockType, objectName, label }: GridColumnAddress): string {
  const block = typeof blockType === 'string' && blockType.length > 0 ? blockType : 'object-grid';
  const parts: string[] = [];
  if (typeof objectName === 'string' && objectName.length > 0) parts.push(`objectName: '${objectName}'`);
  else parts.push('no objectName');
  if (typeof label === 'string' && label.length > 0) parts.push(`label: '${label}'`);
  return `${block} (${parts.join(', ')})`;
}

/**
 * The message for a `columns` array whose entries cannot all resolve, or
 * `null` when every authored entry is fine.
 *
 * Naming the ADDRESS is the whole point: which block, which object, which
 * index, which spelling was seen, and which spelling to write instead. A
 * message that only said something went wrong would leave the author exactly
 * where the silence did.
 */
export function describeUnresolvedColumns(columns: unknown, address: GridColumnAddress): string | null {
  const partition = partitionAuthoredColumns(columns);
  if (!partition || partition.unresolved.length === 0) return null;

  const authored = Array.isArray(columns) ? columns.length : 0;
  const count = partition.unresolved.length;
  const headline = partition.resolved === 0
    ? `${count} of ${authored} authored columns resolve to nothing, so this grid renders its `
      + 'row-number column and NO data columns'
    : `${count} of ${authored} authored columns resolve to nothing and are dropped `
      + `(${partition.resolved} still render)`;

  const lines = partition.unresolved.map((u) => `  • columns[${u.index}]: ${u.detail}`);

  return `[ObjectUI] ObjectGrid columns: ${describeAddress(address)} — ${headline}.\n`
    + `${lines.join('\n')}\n`
    + `  \`ListColumnSchema\` (@objectstack/spec/ui) declares ONE column spelling: `
    + `\`${DECLARED_COLUMN_FIELD_KEY}\` (required — the field name) and `
    + `\`${DECLARED_COLUMN_LABEL_KEY}\` (the header). A plain \`string[]\` of field names `
    + `works too. (objectui#5349)`;
}

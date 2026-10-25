// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowKeyValueField — a small repeatable key/value editor for object-map
 * config (e.g. an action's `params`, a subflow's `input`, request `headers`).
 *
 * Design notes (why local draft state instead of commit-on-keystroke):
 *  - The host inspector owns the draft and re-renders from the top on every
 *    `onPatch`. Committing each keystroke would rehydrate rows mid-edit and
 *    drop focus / collapse half-typed keys. So rows live in LOCAL state and
 *    only flush to `onCommit` on blur, Enter, add, or remove.
 *  - Rows carry a STABLE `id` (not the editable key) so renaming a key never
 *    remounts the row — caret and focus are preserved.
 *  - Values are smart-parsed on commit (number / boolean / else string) so an
 *    author can type `3` or `true` without writing JSON. Empty and duplicate
 *    keys are skipped when flushing (last non-empty wins is avoided — earlier
 *    rows take precedence).
 *  - objectui#7588: on a `value`-role slot (the `assignment` node's
 *    `assignments` map, see `flow-value-envelope.ts`) each value is either TEXT,
 *    the smart-parsed cell above, where a string is stored exactly as typed,
 *    or an EXPRESSION, stored as a CEL value envelope `{ dialect: 'cel',
 *    source }`. The caller opts in through the `valueEnvelope` prop; every
 *    other map renders exactly as before. Through `@objectstack/spec` 17 a
 *    text string was read in the single-brace dialect; from 18 it is literal text, and
 *    the cell shows the spec's refusal of a `{…}` token in it (objectui#12030).
 *    A text cell there is a literal, so it carries no reference picker: the
 *    picker could only insert a `{var}` token the spec refuses (objectui#12101).
 *    A reference is written as an expression, whose picker inserts it bare.
 *  - objectui#12101: on a map whose every value is a flow TEXT slot (the http
 *    node's `headers`, `eachValue` in the spec's `FLOW_NODE_TEXT_SLOTS`) the
 *    caller passes `valueMode: 'hole'`. Each value then renders ADR-0032 §3
 *    `{{ }}` holes: the picker inserts `{{ x }}` and a single brace is flagged
 *    with the double-brace fix, as on a single text slot (objectui#11824).
 *  - objectui#12372: a CRUD node's `filter` is a value slot too (the ledger's
 *    `filterOperands` row), judged per operand by the spec's filter-operand
 *    rule, which the caller passes as `valueRefusal`.
 *  - objectui#12329: on any other map (a connector action's `input`, a legacy
 *    action's `params`) a text value is a literal as well: objectstack#19939
 *    S7 deleted the single-brace resolver, so no flow string outside the text
 *    slots reads a `{…}` token. Its cell has no picker and no reference check.
 */

import * as React from 'react';
import { Code2, Plus, X } from 'lucide-react';
import { Button, Input, Label, cn } from '@object-ui/components';
import { RequiredMarker, uniqueId } from './_shared.js';
import { VariableTextInput } from './VariableTextInput.js';
import type { ScopeGroup } from './useFlowScope.js';
import { FlowExprIssue } from './FlowExprIssue.js';
import {
  ASSIGNMENT_ARRAY_FORM_PRESCRIPTION,
  isEditableValueEnvelope,
  valueEnvelopeRefusal,
  writeValueEnvelope,
} from './flow-value-envelope.js';

export interface Row {
  id: string;
  key: string;
  /** Display string for the value cell: the text, or an expression's `source`. */
  raw: string;
  /**
   * objectui#7588: `'expression'` stores the row as a CEL value envelope.
   * Absent means text, the only form a map that is not a `value`-role slot has.
   */
  mode?: 'expression';
  /** The stored envelope an expression row was read from, so its `meta` survives an edit. */
  envelope?: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Render a stored value as an editable string. */
function toRaw(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Smart-parse an edited value string back to a scalar (no hand-written JSON). */
function parseValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Round-trip non-scalar values losslessly: a filter operator like
  // `{"$ne": null}` or an array must parse back to its object/array form, not
  // be flattened to a string. Template refs like `{leadId}` are not valid JSON
  // and correctly fall through to a plain string.
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Read the stored value as `[key, value]` entries, accepting BOTH shapes a
 * key/value config field can hold: the common object map (`{ var: value }`) and
 * the assignment-node ARRAY form (`[{ variable|name|key, value }]`). The shape
 * is preserved on write (see {@link rowsToValue}).
 */
export function toEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value
      .filter((it): it is Record<string, unknown> => isPlainObject(it))
      .map((it) => {
        const k = it.variable ?? it.name ?? it.key;
        return [typeof k === 'string' ? k : '', it.value] as [string, unknown];
      });
  }
  if (isPlainObject(value)) return Object.entries(value);
  return [];
}

/**
 * Read stored entries into editable rows. With `envelopeSlot`, a stored CEL
 * value envelope in the MAP becomes an expression row. In the legacy array it
 * stays text: an envelope-shaped object there is a literal, and the row shows
 * it as the JSON it is.
 */
export function toRows(value: unknown, existingIds: string[], envelopeSlot = false): Row[] {
  const ids = [...existingIds];
  const readsEnvelopes = envelopeSlot && !Array.isArray(value);
  return toEntries(value).map(([key, val]) => {
    const id = uniqueId('kv', ids);
    ids.push(id);
    if (readsEnvelopes && isEditableValueEnvelope(val)) {
      return { id, key, raw: val.source, mode: 'expression', envelope: val };
    }
    return { id, key, raw: toRaw(val) };
  });
}

/** The value one row stores: its envelope when it is an expression, else the smart-parsed text. */
function rowValue(row: Row): unknown {
  return row.mode === 'expression' ? writeValueEnvelope(row.envelope, row.raw) : parseValue(row.raw);
}

/**
 * Whether flushing `rows` writes the legacy array. The array is kept as long as
 * no row is an expression. An expression row writes the map instead, because
 * the map is the only shape the spec reads a CEL value envelope in
 * (`ASSIGNMENT_ARRAY_FORM_PRESCRIPTION`). Kept values are written unchanged.
 */
function writesArrayShape(rows: Row[], arrayShape: boolean): boolean {
  return arrayShape && !rows.some((r) => r.mode === 'expression');
}

/** Flush rows back to the SAME shape, skipping empty/duplicate keys (first wins). */
export function rowsToValue(
  rows: Row[],
  arrayShape: boolean,
): Record<string, unknown> | Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const kept: Array<[string, Row]> = [];
  for (const r of rows) {
    const k = r.key.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    kept.push([k, r]);
  }
  if (writesArrayShape(kept.map(([, r]) => r), arrayShape)) {
    return kept.map(([k, r]) => ({ variable: k, value: rowValue(r) }));
  }
  const out: Record<string, unknown> = {};
  for (const [k, r] of kept) out[k] = rowValue(r);
  return out;
}

/**
 * Switch one row between text and expression. The typed text carries over as
 * the expression's `source` and back, so nothing the author typed is lost.
 * Text that is already an envelope's JSON becomes that envelope.
 */
export function switchRowMode(row: Row, mode: 'text' | 'expression'): Row {
  if (mode === 'text') {
    if (row.mode !== 'expression') return row;
    return { id: row.id, key: row.key, raw: row.raw };
  }
  if (row.mode === 'expression') return row;
  const parsed = parseValue(row.raw);
  return isEditableValueEnvelope(parsed)
    ? { id: row.id, key: row.key, raw: parsed.source, mode: 'expression', envelope: parsed }
    : { id: row.id, key: row.key, raw: row.raw, mode: 'expression' };
}

/** Stable serialization for the resync guard (order-insensitive for objects). */
function serialize(value: Record<string, unknown> | Array<Record<string, unknown>> | undefined): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  const obj = value ?? {};
  const sorted = Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

export interface FlowKeyValueFieldProps {
  label: string;
  value: unknown;
  onCommit: (value: Record<string, unknown> | Array<Record<string, unknown>> | undefined) => void;
  disabled?: boolean;
  help?: string;
  addLabel: string;
  keyLabel: string;
  valueLabel: string;
  removeLabel: string;
  emptyLabel: string;
  /** In-scope variable references for the data-picker (#1934). */
  scopeGroups?: ScopeGroup[];
  /**
   * objectui#7588: pass this ONLY when the map is a `value`-role slot, which
   * the caller reads off the spec's expression ledger (`isValueEnvelopeSlot`).
   * Each row then gets a text / expression toggle and the spec's envelope
   * refusal inline. Omitted, the editor renders exactly as it always has.
   */
  valueEnvelope?: {
    /** Accessible name of the per-row toggle; pressed means the value is a CEL expression. */
    toggleLabel: string;
    /** Placeholder of an expression row's source input. */
    expressionPlaceholder: string;
  };
  /** The spec requires this map (objectui#10948): the label carries {@link RequiredMarker}. */
  required?: boolean;
  /**
   * objectui#11788: suggestions for the KEY cell — the target object's fields
   * on a record node's field-value map. The key stays free text (a field the
   * catalog does not list yet is still typeable); omitted, the key is a plain
   * box as before.
   */
  keyOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** One line under the rows about where {@link keyOptions} come from. */
  keyHint?: string;
  /**
   * objectui#12101: `'hole'` when every value of the map is a flow text slot
   * that renders `{{ }}` holes. Omitted, a text value is a literal, with no
   * picker: no other flow string reads a `{…}` token (objectui#12329).
   */
  valueMode?: 'hole';
  /**
   * objectui#12372: the spec's judge of one value on this slot, when it is not
   * the value-map rule (`valueEnvelopeRefusal`). A CRUD node's `filter` passes
   * the filter-operand judge, under which a whole query placeholder such as
   * `{today}` is the query engine's and is not refused. Read only with
   * {@link valueEnvelope}.
   */
  valueRefusal?: (value: unknown) => string[] | null;
}

/**
 * In the map, text whose smart-parse is a CEL value envelope IS an expression
 * (the spec tells the forms apart by shape), so the row is shown as one after
 * a flush rather than claiming to be text. Returns `rows` itself when nothing
 * changes.
 */
function promoteEnvelopeText(rows: Row[]): Row[] {
  let changed = false;
  const next = rows.map((r) => {
    if (r.mode === 'expression' || !isEditableValueEnvelope(parseValue(r.raw))) return r;
    changed = true;
    return switchRowMode(r, 'expression');
  });
  return changed ? next : rows;
}

export function FlowKeyValueField({
  label,
  value,
  onCommit,
  disabled,
  help,
  addLabel,
  keyLabel,
  valueLabel,
  removeLabel,
  emptyLabel,
  scopeGroups,
  valueEnvelope,
  required,
  keyOptions,
  keyHint,
  valueMode,
  valueRefusal = valueEnvelopeRefusal,
}: FlowKeyValueFieldProps) {
  const keyListId = React.useId();
  const suggestsKeys = !!keyOptions && keyOptions.length > 0;
  // Preserve whichever shape the value was authored in (object map vs the
  // assignment-node array form) across edits.
  const arrayShape = Array.isArray(value);
  const envelopeSlot = valueEnvelope !== undefined;
  // Normalized serialization of the stored value — used only to detect an
  // EXTERNAL change (node switch) that should resync the rows.
  const external = React.useMemo(
    () => serialize(rowsToValue(toRows(value, [], envelopeSlot), arrayShape)),
    [value, arrayShape, envelopeSlot],
  );
  const [rows, setRows] = React.useState<Row[]>(() => toRows(value, [], envelopeSlot));
  // Track the last value we committed so an external change can resync rows
  // without clobbering an in-progress edit of the same node.
  const lastCommitted = React.useRef(external);

  React.useEffect(() => {
    if (external !== lastCommitted.current) {
      setRows(toRows(value, [], envelopeSlot));
      lastCommitted.current = external;
    }
  }, [external, value, envelopeSlot]);

  /** Commit `nextRows` and return the rows to show afterwards. */
  const flush = (nextRows: Row[]): Row[] => {
    const out = rowsToValue(nextRows, arrayShape);
    lastCommitted.current = serialize(out);
    const empty = Array.isArray(out) ? out.length === 0 : Object.keys(out).length === 0;
    onCommit(empty ? undefined : out);
    return envelopeSlot && !Array.isArray(out) ? promoteEnvelopeText(nextRows) : nextRows;
  };

  const flushShown = () => {
    const shown = flush(rows);
    if (shown !== rows) setRows(shown);
  };

  const setRowField = (id: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((rs) => [...rs, { id: uniqueId('kv', rs.map((r) => r.id)), key: '', raw: '' }]);
  };

  const removeRow = (id: string) => {
    setRows((rs) => flush(rs.filter((r) => r.id !== id)));
  };

  const setRowMode = (id: string, mode: 'text' | 'expression') => {
    setRows((rs) => flush(rs.map((r) => (r.id === id ? switchRowMode(r, mode) : r))));
  };

  // Whether the next flush writes the map: only there is a stored envelope an
  // expression, so only there does the spec's envelope refusal apply.
  const writesMap = !writesArrayShape(rows, arrayShape);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <RequiredMarker />}
      </Label>
      {envelopeSlot && arrayShape && (
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400" role="note">
          {ASSIGNMENT_ARRAY_FORM_PRESCRIPTION}
        </p>
      )}
      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">{emptyLabel}</p>
        )}
        {rows.map((row) => {
          const expression = row.mode === 'expression';
          // A text cell is a literal, with no picker (objectui#12101 for a
          // value-role map, objectui#12329 for every other map), unless the
          // map's values are `{{ }}` text slots.
          const hole = valueMode === 'hole' && !expression;
          const pickerGroups = expression || hole ? (scopeGroups ?? []) : [];
          const refusal = envelopeSlot && writesMap ? valueRefusal(rowValue(row)) : null;
          return (
            <div key={row.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Input
                  list={suggestsKeys ? keyListId : undefined}
                  value={row.key}
                  onChange={(e) => setRowField(row.id, { key: e.target.value })}
                  onBlur={flushShown}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder={keyLabel}
                  disabled={disabled}
                  className="h-8 flex-1 font-mono text-xs"
                />
                <VariableTextInput
                  mode={hole ? 'hole' : 'expression'}
                  mono={expression}
                  value={row.raw}
                  onValueChange={(v) => setRowField(row.id, { raw: v })}
                  onBlur={flushShown}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  groups={pickerGroups}
                  placeholder={expression && valueEnvelope ? valueEnvelope.expressionPlaceholder : valueLabel}
                  disabled={disabled}
                  className="flex-1"
                />
                {valueEnvelope && (
                  <Button
                    type="button"
                    variant={expression ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-8 w-8 shrink-0 p-0', expression ? 'text-foreground' : 'text-muted-foreground')}
                    onClick={() => setRowMode(row.id, expression ? 'text' : 'expression')}
                    disabled={disabled}
                    aria-pressed={expression}
                    aria-label={valueEnvelope.toggleLabel}
                    title={valueEnvelope.toggleLabel}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                  aria-label={removeLabel}
                  title={removeLabel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {refusal ? (
                <div className="space-y-0.5" role="alert">
                  {refusal.map((message, i) => (
                    <p key={i} className="text-[11px] leading-snug text-destructive">
                      {message}
                    </p>
                  ))}
                </div>
              ) : expression ? (
                <FlowExprIssue value={rowValue(row)} role="value" scopeGroups={scopeGroups} />
              ) : hole ? (
                <FlowExprIssue value={row.raw} role="hole" scopeGroups={scopeGroups} />
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {addLabel}
      </Button>
      {suggestsKeys && keyOptions && (
        <datalist id={keyListId}>
          {keyOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </datalist>
      )}
      {keyHint && <p className="text-[11px] leading-snug text-muted-foreground">{keyHint}</p>}
      {help && <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>}
    </div>
  );
}

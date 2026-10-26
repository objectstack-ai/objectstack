// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { DatasetSelection } from '@objectstack/spec/contracts';
import type { CompiledDataset } from './dataset-compiler.js';
import { isNestedRelationCondition } from './strategies/filter-normalizer.js';

/**
 * [#25814] A dataset's filters name OBJECT fields; the cube they are lowered
 * onto resolves a `where` key as a cube MEMBER first. This module is the
 * dataset door's lowering of the one into the other.
 *
 * ## The two namespaces
 *
 * Every filter a dataset query carries — the selection's `runtimeFilter` (a
 * widget's own `filter`, and every dashboard global filter bound to the widget,
 * whose `field` the spec resolves against `dataset.object` and "not against that
 * dataset's declared `dimensions`"), the dataset's intrinsic `filter` and each
 * measure's scoped `filter` — keys its conditions by a field of the dataset's
 * object, or a relationship path from it. The authoring gates read them that way
 * (`dashboard-filter-field-unknown`, `widget-filter-field-unknown`,
 * `dataset-filter-field-unknown`), and so does the draft-preview face, which
 * matches `row[key]` over the object's own rows.
 *
 * `DatasetExecutor` hands those filters to `AnalyticsService.query()` as the
 * compiled cube's `where`, and both strategies — and the field-read admission in
 * front of them — resolve a `where` key through the cube's members first
 * (`lookupMember` / `declaredMemberEntry`): a key that names a dimension or a
 * measure compiles to that member's `sql`, and only an unknown key reaches the
 * base table as a column. For the cube door that is the contract — its `where`
 * speaks the cube's member vocabulary. For the dataset door it is a collision:
 * a dimension `{ name: 'department', field: 'department.name' }` turned the
 * global filter `{ department: <unit id> }` into `department.name = <unit id>`,
 * and every widget on the board read 0, while the preview of the same dataset
 * answered the right rows.
 *
 * ## The binding
 *
 * A filter key `K` is SHADOWED when it names a field of the dataset's object AND
 * a cube member resolves it to some other `sql`. Each shadowed key is bound, for
 * this request only, to a member minted here whose `sql` IS the field `K`, and
 * the filters are rewritten onto that member. Every reader downstream then sees
 * the field the author wrote by the resolution it already uses — the native SQL
 * compiler, the ObjectQL hand-off, the `/analytics/sql` echo and the field-read
 * admission alike — so "the field the gate judged" stays "the column that reached
 * SQL" by construction, with no second resolution rule to keep in step.
 *
 * The minted member lives on the request scope's copy of the cube and nowhere
 * else: `queryDataset` compiles into a request scope (#20356), which `getMeta`
 * never publishes and which is dropped with the call. Its `type` is `'string'`,
 * which reads exactly as an undeclared column does at the one place a filter
 * member's declared type is consulted (the `time` check of the date-window
 * detector) — the comparand's storage form is decided by the field's own
 * declaration (`declaredFieldType`), as it is for any base column.
 *
 * ## What is not bound
 *
 * - A key that is NOT a field of the object keeps today's answer: a key naming
 *   only a dimension (`department_name`) still resolves through that dimension.
 * - A key whose member's `sql` is the key itself (`{ name: 'stage', field:
 *   'stage' }`, the common case) resolves to the same column either way.
 * - A dotted key (a relationship path) and an operator key (`$and`, `$or`,
 *   `$not` are walked; every other `$` key is left as written).
 * - A key carrying a nested-relation condition (`{ department: { name:
 *   'Legal' } }`): no compiler in this package resolves that form through the
 *   cube — it travels to the engine as written (#20887), which already reads the
 *   key as the object's relation field.
 * - Everything, when the host cannot name the object's fields
 *   (`getObjectFieldNames` absent or not answering) — the same "cannot answer,
 *   do not block" tier as the service's other field gates.
 */

/**
 * The columns every object carries whether or not its field map lists them —
 * the same three `assertWhereFields` adds to the probe's answer.
 */
const IMPLICIT_COLUMNS = ['id', 'created_at', 'updated_at'] as const;

/** The suffix a minted member's name carries; see {@link mintMemberName}. */
const MINTED_SUFFIX = '__object_field';

/**
 * Bind every shadowed filter key of one `queryDataset` call to the object field
 * it names. Returns the inputs themselves when nothing is shadowed, so the
 * common case allocates nothing and every downstream identity check still holds.
 *
 * @param fieldNames - The dataset object's field names, or `undefined` when the
 *   host cannot answer (nothing is bound then).
 */
export function bindDatasetFiltersToObjectFields(
  compiled: CompiledDataset,
  selection: DatasetSelection,
  fieldNames: readonly string[] | undefined,
): { compiled: CompiledDataset; selection: DatasetSelection } {
  if (!fieldNames || fieldNames.length === 0) return { compiled, selection };
  const fields = new Set<string>([...fieldNames, ...IMPLICIT_COLUMNS]);
  const { cube } = compiled;

  const filters: unknown[] = [selection.runtimeFilter, compiled.filter, ...Object.values(compiled.measureFilters)];
  const shadowed = new Set<string>();
  for (const filter of filters) {
    for (const key of filterFieldKeys(filter)) {
      if (fields.has(key) && shadowsField(cube, key)) shadowed.add(key);
    }
  }
  if (shadowed.size === 0) return { compiled, selection };

  const bindings = new Map<string, string>();
  const dimensions: Cube['dimensions'] = { ...cube.dimensions };
  for (const key of shadowed) {
    const member = mintMemberName(key, cube, fields, bindings);
    bindings.set(key, member);
    dimensions[member] = { label: key, type: 'string', sql: key };
  }

  const measureFilters: Record<string, FilterCondition> = {};
  for (const [measure, filter] of Object.entries(compiled.measureFilters)) {
    measureFilters[measure] = renameFilterKeys(filter, bindings) as FilterCondition;
  }
  return {
    compiled: {
      ...compiled,
      cube: { ...cube, dimensions },
      filter: renameFilterKeys(compiled.filter, bindings) as FilterCondition | undefined,
      measureFilters,
    },
    selection: {
      ...selection,
      runtimeFilter: renameFilterKeys(selection.runtimeFilter, bindings) as FilterCondition | undefined,
    },
  };
}

/**
 * Does a cube member resolve the bare key `key` to a `sql` other than `key`?
 *
 * Mirrors the tier a bare (undotted) filter member takes in `lookupMember` and
 * `declaredMemberEntry`: the dimension bag first, then the measure bag. The
 * dotted tiers never apply to a bare key.
 */
function shadowsField(cube: Cube, key: string): boolean {
  const member = cube.dimensions[key] ?? cube.measures[key];
  if (!member) return false;
  return typeof member.sql !== 'string' || member.sql.trim() !== key;
}

/**
 * A member name for the field `key` that no cube member, no object field and no
 * earlier binding of this call already uses. Undotted, so no tier of
 * `lookupMember` reads it as a relationship path.
 */
function mintMemberName(
  key: string,
  cube: Cube,
  fields: ReadonlySet<string>,
  bindings: ReadonlyMap<string, string>,
): string {
  const taken = (name: string) =>
    name in cube.dimensions || name in cube.measures || fields.has(name) ||
    [...bindings.values()].includes(name);
  let name = `${key}${MINTED_SUFFIX}`;
  for (let n = 2; taken(name); n++) name = `${key}${MINTED_SUFFIX}_${n}`;
  return name;
}

/**
 * The bare field keys a `FilterCondition` compares, through `$and` / `$or` /
 * `$not`. A dotted key is a relationship path and a key carrying a
 * nested-relation condition goes to the engine as written, so neither is
 * collected; every other `$` key is an operator this walk does not descend.
 */
function filterFieldKeys(filter: unknown): string[] {
  if (!isPlainObject(filter)) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) for (const child of value) keys.push(...filterFieldKeys(child));
    } else if (key === '$not') {
      keys.push(...filterFieldKeys(value));
    } else if (!key.startsWith('$') && !key.includes('.') && !isNestedRelationCondition(value)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * `filter` with every key in `bindings` renamed to its bound member, through
 * `$and` / `$or` / `$not`, except where the key carries a nested-relation
 * condition (see the module header). A key's VALUE is never rewritten: it is
 * the comparison. Copy-on-write — a subtree with nothing to rename comes back as
 * the same object.
 */
function renameFilterKeys(filter: unknown, bindings: ReadonlyMap<string, string>): unknown {
  if (!isPlainObject(filter)) return filter;
  let out: Record<string, unknown> | undefined;
  const entries = Object.entries(filter);
  entries.forEach(([key, value], index) => {
    let nextKey = key;
    let nextValue = value;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        const mapped = value.map((child) => renameFilterKeys(child, bindings));
        if (mapped.some((child, i) => child !== value[i])) nextValue = mapped;
      }
    } else if (key === '$not') {
      nextValue = renameFilterKeys(value, bindings);
    } else if (!isNestedRelationCondition(value)) {
      nextKey = bindings.get(key) ?? key;
    }
    if (out === undefined && (nextKey !== key || nextValue !== value)) {
      out = Object.fromEntries(entries.slice(0, index));
    }
    if (out !== undefined) out[nextKey] = nextValue;
  });
  return out ?? filter;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

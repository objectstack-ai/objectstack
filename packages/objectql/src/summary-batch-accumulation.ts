// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25579] Batch equals one-by-one, for a child rule that reads a parent
 * roll-up `summary` one hop through a reference (ruling 6377847361, letter C:
 * 「批量等于逐条，并发不保证」).
 *
 * ## The hole this closes
 *
 * A bulk insert resolves the related rows its predicate rules read ONCE for
 * the whole batch (`resolvePredicateRelated`), and the roll-up recompute runs
 * once AFTER the batch is written. So every row of one batch read the parent's
 * summary as it stood before the batch: "each supplier has at most one primary
 * contact" (`record.is_primary == true && record.supplier.primary_contact_count
 * > 0`) refused a second primary written one by one and admitted two written
 * in one import.
 *
 * ## What this does
 *
 * Accumulates, IN MEMORY, the rows of the batch the rules have already
 * admitted, per roll-up descriptor and per parent id, and overlays each later
 * row's related binding with the summary value those rows move it to — the
 * value the recompute would have written had the earlier rows been inserted
 * one at a time. ⛔ Nothing here reads the database: the stored row the hop
 * resolved is the base, and the batch's own admitted rows are the delta.
 *
 * - A row the rules REFUSE is never accepted, so it moves nothing a later row
 *   reads. The batch's success semantics (which rows land, which error) are
 *   the engine's, unchanged; only the value the rule reads moves.
 * - The summary's `filter` is evaluated on the new row by the in-memory
 *   aggregation's own walker ({@link matchesAggregationFilter}), so a row the
 *   filter excludes counts for nothing, as it counts for nothing in the
 *   recompute.
 * - [#34466] The same value reaches a field-level `parent.` predicate
 *   (`requiredWhen: parent.line_count >= 3`): the master-detail header it
 *   reads is one row, not a related binding, and {@link
 *   BatchSummaryAccumulator.overlayRow} overlays it the same way. An unbound
 *   header stays unbound.
 *
 * ## Which roll-ups accumulate exactly
 *
 * `count`, and `sum` / `min` / `max` over number values: each is a function of
 * the stored value and the new rows alone. These do NOT, and keep reading the
 * stored value, as before:
 *
 * - `avg` — the stored average does not say how many rows it averages.
 * - `sum` / `min` / `max` meeting a value that is not a number (a date, a
 *   text), or a stored value that is not one.
 * - a summary whose `filter` names a dotted path (it reads through another
 *   reference, which the new row does not carry), or that the walker refuses.
 *
 * Concurrent writes are out of scope: two batches in flight each read the
 * stored value they started from.
 */

import type { SummaryAggregateEngine, SummaryDescriptor } from './summary-aggregate.js';
import { SUMMARY_GROUPED_AGGREGATE_CHUNK, summaryEmptySetValue } from './summary-aggregate.js';
import { ROLLUP_AGGREGATE_OPTION } from './record-currency-aggregate-door.js';
import { declaredFieldClasses, declaredJsonStoredFields, matchesAggregationFilter } from './having-filter.js';
import type { RelatedFieldBinding, RelatedRecordBinding } from './validation/rule-validator.js';

/** One parent's delta from the batch's admitted rows, for one descriptor. */
interface ParentDelta {
  count: number;
  sum: number;
  min: number | undefined;
  max: number | undefined;
}

export interface BatchSummaryAccumulator {
  /**
   * The binding a row's rules read: `binding` with every related row that is a
   * roll-up's parent carrying the summary value the batch's admitted rows move
   * it to. Copies; the shared binding is never mutated. A binding no admitted
   * row moves is returned as it is.
   */
  overlay(binding: RelatedRecordBinding | undefined): RelatedRecordBinding | undefined;
  /**
   * [#34466] `row`, a stored row of `object`, carrying the summary values the
   * batch's admitted rows move it to: the master-detail header a field-level
   * `parent.` predicate (`requiredWhen`) reads, which reaches the rules as one
   * row and not as a related binding. A copy; `row` itself is never mutated.
   * A row no admitted row moves, and an unbound header (`null` /
   * `undefined`, the fail-closed signal), are returned as they are.
   */
  overlayRow<R extends Record<string, unknown> | null | undefined>(object: string, row: R): R;
  /** Count `row` in. Call it only once the row's rules have admitted it. */
  accept(row: Record<string, unknown>): void;
}

const ACCUMULABLE: ReadonlySet<SummaryDescriptor['fn']> = new Set(['count', 'sum', 'min', 'max']);

/** Does the filter name a dotted path anywhere — a read through another reference? */
function filterNamesDottedPath(cond: unknown): boolean {
  if (Array.isArray(cond)) return cond.some(filterNamesDottedPath);
  if (!cond || typeof cond !== 'object') return false;
  for (const [key, value] of Object.entries(cond as Record<string, unknown>)) {
    if (!key.startsWith('$') && key.includes('.')) return true;
    if (key === '$and' || key === '$or' || key === '$not') {
      if (filterNamesDottedPath(value)) return true;
    }
  }
  return false;
}

/**
 * [#34465] Does the filter read through a reference anywhere, in either
 * spelling: a dotted path (`{ 'account.kind': 'x' }`), or the nested
 * one-level form (`{ account: { status: 'x' } }`, a plain object holding a
 * key that is no operator beneath a field), which is the form a summary
 * filter reads a related record with. The in-memory walker does not refuse
 * the nested form: it compares the row's scalar id with the object and
 * answers "no match" for every state, so the predicate update's fold must
 * leave such a roll-up out before any statement, as it leaves the dotted one.
 */
function filterReadsThroughReference(cond: unknown): boolean {
  if (filterNamesDottedPath(cond)) return true;
  if (Array.isArray(cond)) return cond.some(filterReadsThroughReference);
  if (!cond || typeof cond !== 'object') return false;
  for (const [key, value] of Object.entries(cond as Record<string, unknown>)) {
    if (key === '$and' || key === '$or' || key === '$not') {
      if (filterReadsThroughReference(value)) return true;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
      && Object.keys(value).some((inner) => !inner.startsWith('$'))) return true;
  }
  return false;
}

/** A single reference id, or `undefined` for an empty or multi-value slot. */
function singleId(value: unknown): string | undefined {
  if (value == null || value === '' || Array.isArray(value) || typeof value === 'object') return undefined;
  return String(value);
}

/**
 * The accumulator for one bulk insert of `childObject`, or `undefined` when
 * no roll-up aggregates it exactly — the common case, which then pays nothing.
 *
 * `descriptors` are the roll-ups that aggregate `childObject` (the engine's
 * child-side summary index); `childFields` is its declared field map, read for
 * the filter walker's temporal and JSON-stored column rules.
 */
export function createBatchSummaryAccumulator(
  descriptors: readonly SummaryDescriptor[],
  childFields: unknown,
): BatchSummaryAccumulator | undefined {
  const live = descriptors.filter((d) => ACCUMULABLE.has(d.fn) && !filterNamesDottedPath(d.filter));
  if (live.length === 0) return undefined;
  const classes = declaredFieldClasses(childFields);
  const jsonStored = declaredJsonStoredFields(childFields);
  /** Descriptor → parent id → delta. A descriptor that met a value it cannot accumulate is dropped. */
  const deltas = new Map<SummaryDescriptor, Map<string, ParentDelta>>();
  const dropped = new Set<SummaryDescriptor>();

  const accept = (row: Record<string, unknown>): void => {
    for (const desc of live) {
      if (dropped.has(desc)) continue;
      const parentId = singleId(row[desc.fkField]);
      if (parentId === undefined) continue;
      if (desc.filter) {
        let matched: boolean;
        try {
          matched = matchesAggregationFilter(row, desc.filter as any, 0, classes, jsonStored);
        } catch {
          // The walker refuses this filter: no exact answer, so this roll-up
          // keeps reading the stored value for the rest of the batch.
          dropped.add(desc);
          continue;
        }
        if (!matched) continue;
      }
      let value: number | undefined;
      if (desc.fn !== 'count') {
        // A non-count roll-up always names its field (the spec refuses one
        // without); a definition that reached the registry without it reads
        // no value, as an absent column would.
        const raw = desc.sourceField === undefined ? undefined : row[desc.sourceField];
        if (raw == null) continue; // an aggregate skips a null, as SQL does
        if (typeof raw !== 'number' || !Number.isFinite(raw)) { dropped.add(desc); continue; }
        value = raw;
      }
      let byParent = deltas.get(desc);
      if (!byParent) deltas.set(desc, (byParent = new Map()));
      const delta = byParent.get(parentId) ?? { count: 0, sum: 0, min: undefined, max: undefined };
      delta.count += 1;
      if (value !== undefined) {
        delta.sum += value;
        delta.min = delta.min === undefined ? value : Math.min(delta.min, value);
        delta.max = delta.max === undefined ? value : Math.max(delta.max, value);
      }
      byParent.set(parentId, delta);
    }
  };

  /** The summary value `stored` moves to under `delta`, or `undefined` when it cannot be said exactly. */
  const moved = (desc: SummaryDescriptor, stored: unknown, delta: ParentDelta): number | undefined => {
    const base = stored == null ? summaryEmptySetValue(desc.fn) : stored;
    if (base !== null && (typeof base !== 'number' || !Number.isFinite(base))) return undefined;
    switch (desc.fn) {
      case 'count': return (base ?? 0) + delta.count;
      case 'sum': return (base ?? 0) + delta.sum;
      case 'min': return delta.min === undefined ? (base ?? undefined) : base === null ? delta.min : Math.min(base, delta.min);
      case 'max': return delta.max === undefined ? (base ?? undefined) : base === null ? delta.max : Math.max(base, delta.max);
      default: return undefined;
    }
  };

  /** A copy of `row` (a stored row of `object`) with every summary the admitted rows move, or `undefined` when none moves. */
  const patchRow = (object: string, row: Record<string, unknown>): Record<string, unknown> | undefined => {
    const parentId = singleId(row.id);
    if (parentId === undefined) return undefined;
    let patched: Record<string, unknown> | undefined;
    for (const [desc, byParent] of deltas) {
      if (dropped.has(desc) || desc.parentObject !== object) continue;
      if (!(desc.summaryField in row)) continue; // the reader was not handed this roll-up
      const delta = byParent.get(parentId);
      if (!delta) continue;
      const value = moved(desc, row[desc.summaryField], delta);
      if (value === undefined) continue;
      patched ??= { ...row };
      patched[desc.summaryField] = value;
    }
    return patched;
  };

  const overlay = (binding: RelatedRecordBinding | undefined): RelatedRecordBinding | undefined => {
    if (!binding || deltas.size === 0) return binding;
    let out: Record<string, RelatedFieldBinding> | undefined;
    for (const [fk, entry] of Object.entries(binding)) {
      const related = entry.row;
      if (!related) continue;
      const patched = patchRow(entry.object, related);
      if (patched) {
        out ??= { ...binding };
        out[fk] = { ...entry, row: patched };
      }
    }
    return out ?? binding;
  };

  const overlayRow = <R extends Record<string, unknown> | null | undefined>(object: string, row: R): R => {
    if (!row || deltas.size === 0) return row;
    return (patchRow(object, row) as R | undefined) ?? row;
  };

  return { accept, overlay, overlayRow };
}

/**
 * [#34465] Batch equals one-by-one for a PREDICATE update (`multi: true`)
 * whose rules read a parent roll-up — the third door of the family after the
 * bulk insert above (ruling 6377847361, C) and `updateMany` (ruling record
 * 6928862195, B), inheriting both (route A, recorded on the card).
 *
 * A predicate update judges every matched row before its one `updateMany`
 * statement, against related rows and master-detail headers read ONCE for
 * the batch, and recomputes the roll-ups once after it. One by one, the k-th
 * update is judged while the rows before it already stand in their new state
 * and the rest (the k-th included) in their stored one, with the roll-ups
 * recomputed between. So for each roll-up a rule reads, this computes that
 * value exactly:
 *
 * - a base read in the database ({@link loadPredicateUpdateSummaryBases}),
 *   one grouped aggregate per read roll-up and chunk of parents. For `count`,
 *   `sum` and `avg` (its sum and non-null count) the base is every child as
 *   stored, the matched rows included; for `min` / `max` it is the children
 *   OUTSIDE the matched set (`id` not in it), since an extreme cannot be
 *   taken back out;
 * - folded in memory with the matched rows: as row k is judged, every row
 *   before it has left its stored contribution and taken the one the update
 *   gives it.
 *
 * `count`, `sum`, `min`, `max` and `avg` are all exact, a reparent included
 * (a row leaves one parent and joins another). The batch is still judged in
 * full before the one statement, so it stays all-or-nothing. A roll-up whose
 * value the fold cannot say exactly keeps reading the value the binding
 * carries (the stored one, as before), the limits the insert arm names: a
 * value that is not a number, and a `filter` reading through a reference
 * (a dotted path, or the nested one-level form `{ account: { status: 'x' } }`)
 * or one the in-memory walker refuses; and a `min` / `max` under a parent holding more
 * than {@link MIN_MAX_EXCLUDED_ID_BUDGET} matched rows, whose exclusion
 * would not fit one statement.
 */

/**
 * The most matched ids one `min` / `max` base aggregate excludes (`id $nin`).
 * Parents are packed so a statement names at most this many, plus at most
 * {@link SUMMARY_GROUPED_AGGREGATE_CHUNK} parent ids: far below every
 * dialect's bound-parameter limit (SQLite 32766, PostgreSQL 65535).
 */
export const MIN_MAX_EXCLUDED_ID_BUDGET = 5000;

/** Whether a roll-up's base counts the matched rows as stored (else it leaves them out). */
function baseHoldsMatched(fn: SummaryDescriptor['fn']): boolean {
  return fn === 'count' || fn === 'sum' || fn === 'avg';
}

/** One matched row of a predicate update: as stored, and as the update leaves it. */
export interface MatchedRowStates {
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
}

/** One parent's base, as the database aggregates it (see {@link baseHoldsMatched}). */
export interface SummaryBase {
  count: number;
  sum: number;
  /** Rows whose source value is not null (an `avg`'s denominator). */
  nonNull: number;
  min: number | null;
  max: number | null;
}

/** Descriptor → parent id → base. A descriptor absent from the map is not folded. */
export type SummaryBases = Map<SummaryDescriptor, Map<string, SummaryBase>>;

/** A database value as a finite number, or `undefined` when it is not one. */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Read, for each roll-up in `descriptors` and each parent the matched rows
 * name (as stored or as left), its base: every child as stored for `count` /
 * `sum` / `avg`, the children outside the matched set for `min` / `max`. A
 * descriptor whose answer is not a number (a `min` over dates), or whose
 * exclusion does not fit {@link MIN_MAX_EXCLUDED_ID_BUDGET}, is left out, and
 * its roll-up is not folded.
 */
export async function loadPredicateUpdateSummaryBases(
  engine: SummaryAggregateEngine,
  descriptors: readonly SummaryDescriptor[],
  matched: readonly MatchedRowStates[],
  execCtx?: unknown,
): Promise<SummaryBases> {
  const bases: SummaryBases = new Map();
  for (const desc of descriptors) {
    if (filterReadsThroughReference(desc.filter)) continue;
    if (desc.fn !== 'count' && desc.sourceField === undefined) continue;
    const holdsMatched = baseHoldsMatched(desc.fn);
    const parents = new Set<string>();
    /** Parent id (as stored) → the matched ids the database still holds under it. */
    const heldUnder = new Map<string, string[]>();
    for (const { previous, next } of matched) {
      const was = singleId(previous[desc.fkField]);
      const now = singleId(next[desc.fkField]);
      if (was !== undefined) parents.add(was);
      if (now !== undefined) parents.add(now);
      const id = singleId(previous.id);
      if (!holdsMatched && was !== undefined && id !== undefined) {
        const list = heldUnder.get(was) ?? [];
        list.push(id);
        heldUnder.set(was, list);
      }
    }
    if (parents.size === 0) continue;
    // Pack the parents into statements: at most one chunk of parent ids, and
    // (min / max) at most the budget of excluded ids.
    const statements: string[][] = [];
    let current: string[] = [];
    let excludedInCurrent = 0;
    let fits = true;
    for (const id of parents) {
      const held = heldUnder.get(id)?.length ?? 0;
      if (held > MIN_MAX_EXCLUDED_ID_BUDGET) { fits = false; break; }
      if (current.length >= SUMMARY_GROUPED_AGGREGATE_CHUNK || excludedInCurrent + held > MIN_MAX_EXCLUDED_ID_BUDGET) {
        statements.push(current);
        current = [];
        excludedInCurrent = 0;
      }
      current.push(id);
      excludedInCurrent += held;
    }
    if (!fits) continue;
    if (current.length > 0) statements.push(current);
    const byParent = new Map<string, SummaryBase>();
    // The aggregate's aliases must not be the group key's name.
    const alias = desc.fkField === 'value' ? 'summary_value' : 'value';
    const countAlias = desc.fkField === 'value_count' ? 'summary_value_count' : 'value_count';
    let numeric = true;
    for (const chunk of statements) {
      if (!numeric) break;
      const excluded = chunk.flatMap((id) => heldUnder.get(id) ?? []);
      const clauses: Record<string, unknown>[] = [{ [desc.fkField]: { $in: chunk } }];
      if (excluded.length > 0) clauses.push({ id: { $nin: excluded } });
      if (desc.filter) clauses.push(desc.filter);
      if (desc.fn === 'avg') clauses.push({ [desc.sourceField!]: { $ne: null } });
      const aggregations = desc.fn === 'avg'
        ? [{ function: 'sum', field: desc.sourceField, alias }, { function: 'count', alias: countAlias }]
        : [{ function: desc.fn, ...(desc.fn === 'count' ? {} : { field: desc.sourceField }), alias }];
      const rows = await engine.aggregate(desc.childObject, {
        where: clauses.length === 1 ? clauses[0] : { $and: clauses },
        groupBy: [desc.fkField],
        aggregations,
        context: execCtx,
      // [ADR-0144 D6, amended] Each group is one parent's rows through
      // `fkField`, the channel the roll-up's own grouped aggregate rides; every
      // id here is one concrete id (`singleId`).
      }, { [ROLLUP_AGGREGATE_OPTION]: desc.fkField });
      for (const row of rows ?? []) {
        const key = row?.[desc.fkField];
        if (key == null || key === '') continue;
        const raw = row?.[alias];
        const value = raw == null ? undefined : finiteNumber(raw);
        const rawCount = desc.fn === 'avg' ? finiteNumber(row?.[countAlias] ?? 0) : 0;
        if ((raw != null && value === undefined) || rawCount === undefined) { numeric = false; break; }
        const base: SummaryBase = { count: 0, sum: 0, nonNull: 0, min: null, max: null };
        if (desc.fn === 'count') base.count = value ?? 0;
        else if (desc.fn === 'sum') base.sum = value ?? 0;
        else if (desc.fn === 'min') base.min = value ?? null;
        else if (desc.fn === 'max') base.max = value ?? null;
        else if (desc.fn === 'avg') { base.sum = value ?? 0; base.nonNull = rawCount; }
        byParent.set(String(key), base);
      }
    }
    if (!numeric) continue;
    // A parent no row matched has the empty set's base.
    for (const id of parents) if (!byParent.has(id)) byParent.set(id, { count: 0, sum: 0, nonNull: 0, min: null, max: null });
    bases.set(desc, byParent);
  }
  return bases;
}

export interface PredicateUpdateSummaryFold {
  /** {@link BatchSummaryAccumulator.overlay}, with the values the rows judged so far move the roll-ups to. */
  overlay(binding: RelatedRecordBinding | undefined): RelatedRecordBinding | undefined;
  /** {@link BatchSummaryAccumulator.overlayRow}, for the master-detail header. */
  overlayRow<R extends Record<string, unknown> | null | undefined>(object: string, row: R): R;
  /** Matched row `i` has been judged: from here on it counts in the state the update leaves it. */
  advance(i: number): void;
  /** The roll-ups this fold moves, per parent object: their fields and the parents they are read for. */
  foldedSummaries(): Map<string, { fields: Set<string>; parentIds: Set<string> }>;
  /** Hand the fold what computes a parent's fields calculated from its folded roll-ups ({@link SummaryDependents}). */
  setDependents(dependents: SummaryDependents): void;
}

/**
 * The fields of parent `parentId` (a row of `object`) calculated from its
 * roll-ups, computed over that parent with `moved` (the folded roll-up
 * values) in place of the stored ones; `undefined` when none is.
 */
export type SummaryDependents = (object: string, parentId: string, moved: Readonly<Record<string, number | null>>) => Record<string, unknown> | undefined;

/** What one row adds to one parent's roll-up. */
interface Contribution { parentId: string; value: number | undefined }

/**
 * The matched rows' part of one parent's roll-up, relative to its base: a bag,
 * so a row can leave it again. Over a base that holds the matched rows as
 * stored (count / sum / avg) the bag starts empty and goes negative as rows
 * leave; `values` (min / max only) never does.
 */
interface Bag { count: number; sum: number; nonNull: number; values: Map<number, number> }

/**
 * The fold for one predicate update, or `undefined` when no roll-up is folded
 * (`bases` empty — the common case, which then pays nothing). `matched` is in
 * the order the rows are judged; before any {@link
 * PredicateUpdateSummaryFold.advance}, every matched row counts as stored.
 */
export function createPredicateUpdateSummaryFold(
  bases: SummaryBases,
  matched: readonly MatchedRowStates[],
  childFields: unknown,
): PredicateUpdateSummaryFold | undefined {
  if (bases.size === 0) return undefined;
  const classes = declaredFieldClasses(childFields);
  const jsonStored = declaredJsonStoredFields(childFields);
  const live = new Map(bases);

  /** The row's contribution to `desc`, `null` for none, `undefined` when it cannot be said exactly. */
  const contributionOf = (desc: SummaryDescriptor, row: Record<string, unknown>): Contribution | null | undefined => {
    const parentId = singleId(row[desc.fkField]);
    if (parentId === undefined) return null;
    if (desc.filter) {
      try {
        if (!matchesAggregationFilter(row, desc.filter as any, 0, classes, jsonStored)) return null;
      } catch {
        return undefined;
      }
    }
    if (desc.fn === 'count') return { parentId, value: undefined };
    const raw = row[desc.sourceField!];
    if (raw == null) return { parentId, value: undefined };
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return { parentId, value: raw };
  };

  /** Descriptor → [previous, next] contribution per matched row. */
  const contributions = new Map<SummaryDescriptor, Array<[Contribution | null, Contribution | null]>>();
  for (const desc of [...live.keys()]) {
    const list: Array<[Contribution | null, Contribution | null]> = [];
    let exact = true;
    for (const { previous, next } of matched) {
      const was = contributionOf(desc, previous);
      const now = contributionOf(desc, next);
      if (was === undefined || now === undefined) { exact = false; break; }
      list.push([was, now]);
    }
    if (exact) contributions.set(desc, list);
    else live.delete(desc);
  }
  if (live.size === 0) return undefined;

  const bags = new Map<SummaryDescriptor, Map<string, Bag>>();
  const move = (desc: SummaryDescriptor, c: Contribution | null, sign: 1 | -1): void => {
    if (!c) return;
    let byParent = bags.get(desc);
    if (!byParent) bags.set(desc, (byParent = new Map()));
    const bag = byParent.get(c.parentId) ?? { count: 0, sum: 0, nonNull: 0, values: new Map<number, number>() };
    bag.count += sign;
    if (c.value !== undefined) {
      bag.sum += sign * c.value;
      bag.nonNull += sign;
      if (baseHoldsMatched(desc.fn)) { byParent.set(c.parentId, bag); return; }
      const left = (bag.values.get(c.value) ?? 0) + sign;
      if (left > 0) bag.values.set(c.value, left);
      else bag.values.delete(c.value);
    }
    byParent.set(c.parentId, bag);
  };
  // A min / max base leaves the matched rows out: they start in the bag as stored.
  for (const [desc, list] of contributions) if (!baseHoldsMatched(desc.fn)) for (const [was] of list) move(desc, was, 1);

  /** The roll-up's value for `parentId` in the current state, or `undefined` when this fold does not say it. */
  const valueOf = (desc: SummaryDescriptor, parentId: string): number | null | undefined => {
    const base = live.get(desc)?.get(parentId);
    if (!base) return undefined;
    const bag = bags.get(desc)?.get(parentId);
    const extreme = (pick: (a: number, b: number) => number, start: number | null): number | null => {
      let out = start;
      for (const v of bag?.values.keys() ?? []) out = out === null ? v : pick(out, v);
      return out;
    };
    switch (desc.fn) {
      case 'count': return base.count + (bag?.count ?? 0);
      case 'sum': return base.sum + (bag?.sum ?? 0);
      case 'min': return extreme(Math.min, base.min);
      case 'max': return extreme(Math.max, base.max);
      case 'avg': {
        const n = base.nonNull + (bag?.nonNull ?? 0);
        return n === 0 ? summaryEmptySetValue('avg') : (base.sum + (bag?.sum ?? 0)) / n;
      }
      default: return undefined;
    }
  };

  let dependents: SummaryDependents | undefined;

  const patchRow = (object: string, row: Record<string, unknown>): Record<string, unknown> | undefined => {
    const parentId = singleId(row.id);
    if (parentId === undefined) return undefined;
    const moved: Record<string, number | null> = {};
    let any = false;
    for (const desc of live.keys()) {
      if (desc.parentObject !== object) continue;
      const value = valueOf(desc, parentId);
      if (value === undefined) continue;
      moved[desc.summaryField] = value;
      any = true;
    }
    if (!any) return undefined;
    let patched: Record<string, unknown> | undefined;
    for (const [field, value] of Object.entries(moved)) {
      if (!(field in row)) continue;
      patched ??= { ...row };
      patched[field] = value;
    }
    // A formula or stored computed field of the parent calculated from a
    // folded roll-up (`remaining = budget - spent`) is computed again over
    // the parent with the folded values, as the recompute's write and the
    // next read would compute it.
    const computed = dependents?.(object, parentId, moved);
    if (computed) {
      for (const [field, value] of Object.entries(computed)) {
        if (!(field in row)) continue;
        patched ??= { ...row };
        patched[field] = value;
      }
    }
    return patched;
  };

  const overlay = (binding: RelatedRecordBinding | undefined): RelatedRecordBinding | undefined => {
    if (!binding) return binding;
    let out: Record<string, RelatedFieldBinding> | undefined;
    for (const [fk, entry] of Object.entries(binding)) {
      if (!entry.row) continue;
      const patched = patchRow(entry.object, entry.row);
      if (patched) {
        out ??= { ...binding };
        out[fk] = { ...entry, row: patched };
      }
    }
    return out ?? binding;
  };

  const overlayRow = <R extends Record<string, unknown> | null | undefined>(object: string, row: R): R => {
    if (!row) return row;
    return (patchRow(object, row) as R | undefined) ?? row;
  };

  const advance = (i: number): void => {
    for (const [desc, list] of contributions) {
      const pair = list[i];
      if (!pair) continue;
      move(desc, pair[0], -1);
      move(desc, pair[1], 1);
    }
  };

  const foldedSummaries = (): Map<string, { fields: Set<string>; parentIds: Set<string> }> => {
    const out = new Map<string, { fields: Set<string>; parentIds: Set<string> }>();
    for (const [desc, byParent] of live) {
      let entry = out.get(desc.parentObject);
      if (!entry) out.set(desc.parentObject, (entry = { fields: new Set(), parentIds: new Set() }));
      entry.fields.add(desc.summaryField);
      for (const id of byParent.keys()) entry.parentIds.add(id);
    }
    return out;
  };

  return { overlay, overlayRow, advance, foldedSummaries, setDependents: (fn) => { dependents = fn; } };
}

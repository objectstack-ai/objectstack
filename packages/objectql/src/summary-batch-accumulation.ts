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

import type { SummaryDescriptor } from './summary-aggregate.js';
import { summaryEmptySetValue } from './summary-aggregate.js';
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
        const raw = row[desc.sourceField];
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

  const overlay = (binding: RelatedRecordBinding | undefined): RelatedRecordBinding | undefined => {
    if (!binding || deltas.size === 0) return binding;
    let out: Record<string, RelatedFieldBinding> | undefined;
    for (const [fk, entry] of Object.entries(binding)) {
      const related = entry.row;
      if (!related) continue;
      const parentId = singleId(related.id);
      if (parentId === undefined) continue;
      let patched: Record<string, unknown> | undefined;
      for (const [desc, byParent] of deltas) {
        if (dropped.has(desc) || desc.parentObject !== entry.object) continue;
        if (!(desc.summaryField in related)) continue; // the rule does not read this roll-up
        const delta = byParent.get(parentId);
        if (!delta) continue;
        const value = moved(desc, related[desc.summaryField], delta);
        if (value === undefined) continue;
        patched ??= { ...related };
        patched[desc.summaryField] = value;
      }
      if (patched) {
        out ??= { ...binding };
        out[fk] = { ...entry, row: patched };
      }
    }
    return out ?? binding;
  };

  return { accept, overlay };
}

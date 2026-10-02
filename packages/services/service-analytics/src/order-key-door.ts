// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21267] An analytics `order` key must name a member the query SELECTS — a
 * column the answer carries — or the query is refused `INVALID_FIELD` / 400 at
 * the analytics door, before either strategy runs.
 *
 * ## Why a key outside the selection names nothing
 *
 * The answer of an aggregate query is its selected dimensions and measures, one
 * row per group. A key outside them names nothing in that answer: SQL refuses
 * it, and the one dialect that accepts it orders the groups by an arbitrary
 * row's value. So no reading of an unselected key is both defined and portable.
 * Both strategies write the key into `ORDER BY` as an output-column name
 * (`ORDER BY "<key>"`), which names a column only when the member is selected.
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `origin/main` `3196ef1a1`, SQLite and PostgreSQL 16.14. A cube over a
 * `deal` object declares no join; `owner` is a lookup whose target also
 * declares `note`:
 *
 * | query | native SQLite | native PostgreSQL | ObjectQL face |
 * |:--|:--|:--|:--|
 * | `dimensions: ['owner.email']`, `order: { note }` | 500 | 500 (42702, `note` ambiguous) | 200 |
 * | `dimensions: ['note']`, `order: { amount }` | 200, ordered by an arbitrary row | 500 (42803, must appear in GROUP BY) | 200 |
 * | `dimensions: ['note']`, `order: { 'owner.email' }` | 500 | 500 (42703, no such column) | 200 |
 *
 * The ObjectQL face answered 200 because its execution then never applied
 * `order` at all (it does since #21316, over the selected columns this door
 * admits); its echoed statement and `/analytics/sql` showed the same
 * `ORDER BY` the native face could not run.
 *
 * ## What "selected" means
 *
 * {@link selectedMembers}: every `dimensions` entry, every `measures` entry,
 * and every `timeDimensions` entry that carries a `granularity` — a bucket the
 * answer carries as a column. A `timeDimensions` entry with no granularity only
 * bounds the rows by a window and is not a column, so it is not orderable.
 *
 * A key matches by its EXACT spelling. The column the answer carries is keyed
 * by the spelling the caller sent (a `<cube>.`-qualified measure keeps its
 * qualifier) and both strategies emit the key as that column's name, so
 * `order: { 'account.revenue_sum' }` beside `measures: ['revenue_sum']` names no
 * column either.
 *
 * ## Where it runs
 *
 * `AnalyticsService.callCtx`, the one seam `query()` (`/analytics/query`, and
 * every query a dataset selection runs through `DatasetExecutor`) and
 * `generateSql()` (`/analytics/sql`) share — so both doors and the native-SQL
 * and the ObjectQL face give one answer on every driver:
 *
 * - after `ensureCube`, so an unknown cube still answers 404 first;
 * - after the admission verdicts (object, stored metadata body, field read
 *   and field query), so a key naming a field the caller may not read keeps
 *   the 403 that field gets in every other position;
 * - before the read scopes are resolved and before any strategy is selected.
 *
 * The dataset door already refuses an unselected `selection.order` key itself
 * (`resolveOrdering`, `DATASET_INVALID`) and pushes an `order` down into its
 * query only when every key is a dimension or measure that query selects, so
 * this door never refuses a dataset selection it accepted.
 */

import type { AnalyticsQuery } from '@objectstack/spec/contracts';

/**
 * The dimensions a query PROJECTS, in the order the answer carries them: every
 * `dimensions` entry, then every `timeDimensions` entry with a `granularity`
 * that is not already one of them.
 *
 * `timeDimensions` is not merely a filter carrier. An entry with a
 * `granularity` is GROUPED BY, so its bucket is a COLUMN of the answer; an
 * entry without one only contributes a `dateRange` predicate and is NOT
 * projected. One definition: `ObjectQLStrategy` groups, maps rows and describes
 * `fields` by it, and this door orders by it.
 */
export function projectedDimensions(query: AnalyticsQuery): string[] {
  const out = [...(query.dimensions ?? [])];
  for (const td of query.timeDimensions ?? []) {
    if (td.granularity && !out.includes(td.dimension)) out.push(td.dimension);
  }
  return out;
}

/** Every column an analytics query's answer carries: its projected dimensions, then its measures. */
export function selectedMembers(query: AnalyticsQuery): string[] {
  return [...projectedDimensions(query), ...(query.measures ?? [])];
}

/**
 * Refuse a query whose `order` names a key that is not one of
 * {@link selectedMembers} — `INVALID_FIELD` / 400, the envelope the door's
 * member gates answer with, naming every such key and the members the query
 * does select. `field` is the first such key and `param` is `order`.
 */
export function assertOrderKeysSelected(query: AnalyticsQuery): void {
  const order = (query as { order?: unknown }).order;
  if (!order || typeof order !== 'object' || Array.isArray(order)) return;
  const keys = Object.keys(order);
  if (keys.length === 0) return;
  const selected = selectedMembers(query);
  const unselected = keys.filter((key) => !selected.includes(key));
  if (unselected.length === 0) return;

  const named = unselected.map((key) => `'${key}'`).join(', ');
  const several = unselected.length > 1;
  const err = new Error(
    `Order key${several ? 's' : ''} ${named} on cube '${query.cube}' name${several ? '' : 's'} no member ` +
      `this query selects, so the query was not run. An \`order\` key must be a column the answer carries — ` +
      `a \`dimensions\` entry, a \`measures\` entry, or a \`timeDimensions\` entry with a \`granularity\` — ` +
      `spelled exactly as it is selected. Selected here: ${selected.join(', ') || '(none)'}. ` +
      `Select ${several ? 'each key' : 'the key'} (add it to \`dimensions\` or \`measures\`) or drop it from \`order\`.`,
  ) as Error & { code?: string; status?: number; field?: string; param?: string };
  err.code = 'INVALID_FIELD';
  err.status = 400;
  err.field = unselected[0];
  err.param = 'order';
  throw err;
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One row per group, compiled into `find`'s own statement.
 *
 * The engine (`@objectstack/objectql`, `latest-per.ts`) hands `find` an AST
 * carrying {@link LATEST_PER_DIRECTIVE}: the fields that form a group and the
 * order whose first row is the group's answer. `find` keeps every clause it
 * always builds — the tenant wall, the read's final `where`, its ORDER BY,
 * paging, projection and presentation — and adds ONE predicate:
 *
 * ```sql
 * id IN (SELECT id FROM (
 *          SELECT id, ROW_NUMBER() OVER (
 *                   PARTITION BY p1, p2
 *                   ORDER BY CASE WHEN o1 IS NULL THEN 1 ELSE 0 END, o1 DESC, …, id DESC) AS rn
 *          FROM table
 *          WHERE <tenant wall> AND <the read's final where>) w
 *        WHERE rn = 1)
 * ```
 *
 * - **The window runs over the fully scoped read.** The inner statement is
 *   scoped by {@link SqlDriver.applyTenantScope} with the read's own options,
 *   and filtered by the same final `where` the outer statement carries — the
 *   one the engine composed with every row-level scope. So a group's answer is
 *   its first row among the rows this read may return, never a row the read
 *   would have hidden.
 * - **Ties are broken by `id`**, in the direction of the last order key, so the
 *   answer is deterministic whatever the data.
 * - **A NULL order value ranks last** in either direction, on every dialect
 *   (the CASE key), so "latest" never means "the one with no date".
 * - **No helper column reaches the rows**: the row number lives inside the
 *   subquery; the outer statement selects what `find` always selects.
 *
 * ⛔ Never `findWithWindowFunctions`: it is a different door with a different
 * contract, and the window here is part of `find`'s statement so that `find`'s
 * every rule holds for it.
 */

import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import type { SqlDriver } from './sql-driver.js';

/**
 * The AST key `find` reads the window from. The engine sets the same
 * `Symbol.for` key on the composed AST it hands the driver, after every
 * middleware has run.
 */
export const LATEST_PER_DIRECTIVE: unique symbol = Symbol.for('objectstack.driver.find.latestPer');

/** One key of the order that decides which row of a group is the answer. */
export interface LatestPerDirectiveOrder {
  readonly field: string;
  readonly order: 'asc' | 'desc';
}

/** What the engine hands `find` under {@link LATEST_PER_DIRECTIVE}. */
export interface LatestPerDirective {
  readonly by: readonly string[];
  readonly orderBy: readonly LatestPerDirectiveOrder[];
}

/** The derived table's alias and its row-number column: never a row key. */
const WINDOW_ALIAS = '__os_latest_per';
const ROW_NUMBER_COLUMN = '__os_latest_per_rn';

const isFieldName = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * The directive on `query`, checked — or `undefined` when none rides there. A
 * directive built wrong is our own plumbing, refused rather than half-read.
 */
export function latestPerDirectiveOf(query: unknown): LatestPerDirective | undefined {
  if (query === null || typeof query !== 'object') return undefined;
  const directive = (query as Record<symbol, unknown>)[LATEST_PER_DIRECTIVE];
  if (directive === undefined) return undefined;
  const by = (directive as { by?: unknown } | null)?.by;
  const orderBy = (directive as { orderBy?: unknown } | null)?.orderBy;
  const wellFormed = Array.isArray(by) && by.length > 0 && by.every(isFieldName)
    && Array.isArray(orderBy) && orderBy.length > 0
    && orderBy.every((k) => isFieldName((k as { field?: unknown } | null)?.field)
      && ((k as { order?: unknown }).order === 'asc' || (k as { order?: unknown }).order === 'desc'));
  if (!wellFormed) {
    throw new Error('find(): the engine-internal latest-per directive is malformed; the query was NOT run.');
  }
  return directive as LatestPerDirective;
}

/** What {@link latestPerIdSubquery} reads off the driver. */
export interface LatestPerHost {
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  getBuilder: SqlDriver['getBuilder'];
  readonly knex: SqlDriver['knex'];
  mapSortField: SqlDriver['mapSortField'];
  remoteColumn: SqlDriver['remoteColumn'];
}

/**
 * The ids of each group's first row, as one subquery `find` embeds as
 * `id IN (…)`. Tenant-walled with the read's own options and filtered by the
 * read's own final `where`; it carries no transaction of its own — it is part
 * of the outer statement, which does.
 */
export function latestPerIdSubquery(
  this: Pick<LatestPerHost, 'applyFilters' | 'applyTenantScope' | 'getBuilder' | 'knex' | 'mapSortField' | 'remoteColumn'>,
  object: string,
  where: FilterCondition | undefined,
  directive: LatestPerDirective,
  options?: DriverOptions,
): Knex.QueryBuilder {
  const column = (field: string): string => this.remoteColumn(object, field, this.mapSortField(field));
  const idColumn = this.remoteColumn(object, 'id', 'id');
  const bindings: string[] = [];
  const partition = directive.by.map((field) => { bindings.push(column(field)); return '??'; }).join(', ');
  const order: string[] = [];
  for (const key of directive.orderBy) {
    const physical = column(key.field);
    bindings.push(physical, physical);
    order.push(`CASE WHEN ?? IS NULL THEN 1 ELSE 0 END, ?? ${key.order === 'desc' ? 'DESC' : 'ASC'}`);
  }
  const last = directive.orderBy[directive.orderBy.length - 1];
  bindings.push(idColumn);
  order.push(`?? ${last.order === 'desc' ? 'DESC' : 'ASC'}`);
  bindings.push(ROW_NUMBER_COLUMN);
  const rowNumber = this.knex.raw(
    `ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${order.join(', ')}) AS ??`,
    bindings,
  );

  const windowed = this.getBuilder(object).select(idColumn, rowNumber);
  this.applyTenantScope(windowed, object, options);
  if (where) this.applyFilters(windowed, where, options);

  return this.knex
    .select(idColumn)
    .from(windowed.as(WINDOW_ALIAS))
    .where(ROW_NUMBER_COLUMN, 1);
}

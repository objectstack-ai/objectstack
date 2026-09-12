// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17175] Seam-double support: recognise the shared presence probe.
 *
 * The `kernel:ready` migrations used to ask "is this table here?" with a
 * statement that could only answer "no" by being REFUSED, so a seam double said
 * "the table is there" by simply not throwing, and every double in this package
 * dispatched on the substring `WHERE 1 = 0`. Since #17175 the question is asked
 * of the CATALOG, and a catalog that returns zero rows means ABSENT — so a
 * double that falls through to its `return []` now says the table is gone.
 *
 * ⇒ A double that means "present" has to answer the catalog statement with a
 * ROW, and this is how it recognises one. Derived from
 * {@link buildTablePresenceSql} rather than pasted, so an arm whose text changes
 * moves every double with it instead of leaving one quietly answering nothing.
 *
 * ⛔ Test support only. Nothing under `src/index.ts` imports it, so it is not
 * bundled, and it carries no `vitest` import so the assertions stay in the
 * fixture that owns them.
 */

import { buildTablePresenceSql } from './read-probe.js';

/**
 * Every knex client spelling `read-probe.ts` compiles a catalog arm for — the
 * union of its three families, so a double recognises the probe whatever
 * dialect the test names.
 */
const CATALOG_CLIENTS: readonly string[] = [
  'sqlite3',
  'sqlite',
  'better-sqlite3',
  'postgres',
  'pg',
  'postgresql',
  'pgnative',
  'mysql',
  'mysql2',
];

/** Is `sql` the catalog presence statement for `table`, on any supported dialect? */
export function isTablePresenceCatalogSql(sql: string, table: string): boolean {
  return CATALOG_CLIENTS.some((client) => buildTablePresenceSql(table, client) === sql);
}

/**
 * The row a double returns to mean "yes, that table is here".
 *
 * The column name is irrelevant — every arm projects a bare `1` and the probe
 * only counts rows — so this is one row of anything.
 */
export const TABLE_IS_PRESENT_ROWS: Record<string, unknown>[] = [{ present: 1 }];

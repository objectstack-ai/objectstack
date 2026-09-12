// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [#17175] The shared read-probe layer for the `kernel:ready` migrations —
 *          what a result set looks like on the three dialects, and the ONE
 *          non-raising table-presence probe built on them.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## The defect this closes
 *
 * Two migrations on the `kernel:ready` hook ask "does this table exist?" by
 * running a statement that CANNOT succeed when the answer is no:
 *
 *   * `seed-tenancy-backfill.ts` — `SELECT "tenant_id" FROM
 *     "_objectstack_sequences" WHERE 1 = 0`, on every install that has never
 *     allocated an autonumber;
 *   * `sys-setting-identity-index.ts` — `SELECT 1 FROM sys_setting WHERE 1 = 0`,
 *     on every kernel that does not register the OPTIONAL `service-settings`.
 *
 * Both catch the refusal and read it as "no". Neither is a defect on its own
 * terms. But the refusal travels through `SqlDriver.execute()`, whose raw
 * terminal writes the statement and the dialect's message to the operator's
 * log on the way out — measured on this tree, exactly one line per probe, on
 * `console.warn`, i.e. **stderr**, carrying both the `DATABASE_ERROR` token and
 * the dialect's `no such table`:
 *
 * ```
 * [sql-driver] DATABASE_ERROR — the backend refused a raw statement (SQLITE_ERROR).
 *   … statement: SELECT "tenant_id" FROM "_objectstack_sequences" WHERE 1 = 0;
 *   dialect: … - no such table: _objectstack_sequences
 * ```
 *
 * ⭐ The cost is not the line. It is that operators learn this product prints
 * errors when nothing is wrong, and then miss the one that matters. A consumer
 * told to read the boot log — `objectstack-ai/hotclm`'s `AGENTS.md` says "a boot
 * that logs warnings is not a passing boot", naming `no such table` — must
 * either ignore an unactionable line every boot or chase a platform-internal
 * probe. `sys-setting-identity-index.ts`'s own docblock states the same cost in
 * its own words, while printing one of these lines.
 *
 * ## ⛔ Why the repair is here and NOT in the driver
 *
 * The driver cannot tell these two apart, and the reason is structural rather
 * than an oversight. Quietening a refusal requires CLASSIFYING it, this repo has
 * exactly one predicate for that (`isMissingTableError`, `@objectstack/types`),
 * and it needs `readObject` — the name of the thing the caller was reading —
 * both to avoid the #13324 fail-open and because
 * `driver-error-classification.callers.test.ts` fails any in-repo call that
 * omits it. The raw path has no such name: `execute()` takes a string, and
 * `rawStatementFaultError` declares no targeted table (pinned by
 * `sql-driver-16019-raw-statement-fault-envelope.test.ts`). An unclassified
 * demotion of the whole raw terminal would quieten real failures too.
 *
 * ⇒ The caller knows the table. The driver does not. So the probe moves, not
 * the log — and it moves ONCE, here, rather than once per probe site.
 *
 * ## ⛔ The fence: "absent" and "could not look" are different answers
 *
 * The failure mode this helper is written against is its own: a catalog arm
 * that is mis-compiled for some dialect raises, is caught by the same `catch`
 * the expected miss uses, and reads as "the table is not there" — turning a
 * stored-row data repair into a SILENT no-op on whichever dialect nobody
 * exercised. That is strictly worse than a noisy log.
 *
 * ⇒ {@link readTablePresence} returns FOUR verdicts, not a boolean, and
 * `'unreadable'` is ⛔ never folded into `'absent'`. The caller is required to
 * treat it as a report, not as an answer. Both directions are pinned in
 * `read-probe.test.ts`; a helper that could not tell them apart would be
 * refused however clean it read.
 *
 * ## Dialect coverage
 *
 * The three catalog arms are compiled from the knex client name, using the SAME
 * three spelling sets `SqlDriver` itself emits SQL for. They are re-spelled here
 * rather than imported, for the reason this package already re-spells
 * `GLOBAL_TENANT`: `metadata-protocol` must not depend on a driver.
 *
 * A client in NONE of the three sets gets no catalog statement and falls back to
 * the caller's own pre-existing `WHERE 1 = 0` probe — which still raises, and so
 * still prints, exactly as it did before this change. That path is not a
 * regression and it is not silent: its refusal is now CLASSIFIED with
 * `isMissingTableError(error, table)`, so an unrecognised dialect that refuses
 * for some OTHER reason reports `'unreadable'` where it used to be swallowed as
 * absence. ⛔ Guessing a catalog spelling for an unknown dialect is exactly the
 * mis-compiled arm the fence is about, so it is not done.
 *
 * ⚠️ The three arms must agree on WHAT COUNTS as present, or they answer three
 * different questions. All three count tables and views: `sqlite_master` is
 * filtered to `('table','view')`, `to_regclass` resolves any relation on the
 * search path, and `information_schema.tables` lists both.
 */

import { isMissingTableError, operatorFacingErrorText } from '@objectstack/types';

/**
 * A raw-SQL read seam, in the shape BOTH migration seams satisfy.
 *
 * Deliberately one parameter: `SeedTenancyExec` is `(sql, params?)` and
 * `IndexExec` is `(sql)`, and a one-parameter target accepts both. Nothing here
 * binds a value — the only thing interpolated is a table name, which cannot be a
 * bound parameter in any of the three dialects anyway, and which
 * {@link isProbeableTableName} restricts to a plain identifier first.
 */
export type ReadProbeExec = (sql: string) => Promise<unknown>;

/**
 * Is `result` one of the result-set shapes a raw SELECT can come back as?
 *
 * The same three {@link normalizeRows} flattens, asked as a yes/no: a bare row
 * array (better-sqlite3 through knex), `{ rows }` (pg), and the `[rows, fields]`
 * tuple (mysql2). An empty result set in any of those spellings is still a
 * result set, and still `true` — that is what keeps a healthy install's
 * `no-split` intact, and it is the half of #10789 that stopped it being a
 * rename.
 *
 * This cannot lose a split that {@link normalizeRows} would have found: every
 * shape it rejects is one already flattened to `[]`, so the only change is
 * "reported as unreadable" replacing "reported as zero rows".
 *
 * ⛔ NOT exported from the package index. It has no consumer outside this
 * package, and the CLI's `migrate/duplicates.ts` carries its own copy for its
 * own probes (#10677) — unifying the two is a separate decision, exactly as
 * `quoteIdent` records for the same pair.
 *
 * [#17175] Re-homed here from `seed-tenancy-backfill.ts`, unchanged, so the
 * shared presence probe can be built on it without importing from one of its own
 * callers. `seed-tenancy-backfill.ts` re-exports it, so every existing importer
 * and the package index are untouched.
 */
export function isResultSet(result: unknown): boolean {
  if (Array.isArray(result)) return true;
  if (typeof result === 'object' && result !== null) {
    return Array.isArray((result as { rows?: unknown }).rows);
  }
  return false;
}

/**
 * Flatten the three result shapes the supported dialects return from a raw
 * SELECT into one row list.
 *
 * `better-sqlite3` (through knex) returns a bare row array; `pg` returns
 * `{ rows, rowCount, … }`; `mysql2` returns the tuple `[rows, fields]`. A
 * migration that read only one of them would silently see zero rows on the other
 * two — and "zero rows" is this module's every-branch no-op, so the failure
 * would look exactly like a healthy install.
 *
 * [#17175] Re-homed here from `seed-tenancy-backfill.ts`, unchanged and still
 * re-exported from there, which is what the package index publishes.
 */
export function normalizeRows(result: unknown): Record<string, unknown>[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    // mysql2's `[rows, fields]`: the first element is itself the row array.
    if (result.length > 0 && Array.isArray(result[0])) {
      return result[0] as Record<string, unknown>[];
    }
    return result as Record<string, unknown>[];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Why a probe was treated as unreadable — the `detail` an operator reads. */
export const SEAM_NO_ANSWER_DETAIL =
  'the raw-SQL seam returned no result set — a seam that cannot answer is not a seam that answered "no rows"';

/**
 * SQLite knex client spellings — the set `SqlDriver.SQLITE_EMIT_CLIENTS` holds.
 * @see the module header on why these are re-spelled rather than imported.
 */
const SQLITE_CLIENTS: ReadonlySet<string> = new Set(['sqlite3', 'sqlite', 'better-sqlite3']);
/** Postgres knex client spellings — `SqlDriver.POSTGRES_EMIT_CLIENTS`. */
const POSTGRES_CLIENTS: ReadonlySet<string> = new Set(['postgres', 'pg', 'postgresql', 'pgnative']);
/** MySQL knex client spellings — `SqlDriver.MYSQL_EMIT_CLIENTS`. */
const MYSQL_CLIENTS: ReadonlySet<string> = new Set(['mysql', 'mysql2']);

/**
 * Which catalog family a knex client name belongs to, or `undefined`.
 *
 * `undefined` is a REAL answer — "this helper has no catalog statement it can
 * honestly compile for that client" — and the caller's fallback probe is what
 * answers instead. ⛔ It is never resolved to a default family: a default is a
 * guess, and a guessed catalog arm is the fence's failure mode.
 */
function catalogFamilyOf(client?: string): 'sqlite' | 'postgres' | 'mysql' | undefined {
  const c = String(client ?? '').toLowerCase();
  if (SQLITE_CLIENTS.has(c)) return 'sqlite';
  if (POSTGRES_CLIENTS.has(c)) return 'postgres';
  if (MYSQL_CLIENTS.has(c)) return 'mysql';
  return undefined;
}

/**
 * Is this a name that may be interpolated into a catalog statement?
 *
 * The table name reaches the catalog arms as a string LITERAL, not as an
 * identifier and not as a bound parameter (`IndexExec` binds nothing). Every
 * caller passes a module constant, and the platform's own naming rule is
 * `snake_case` machine names, so a name this rejects is one the platform could
 * not have written. Rejecting it yields no catalog statement — the same road an
 * unrecognised dialect takes — rather than an escaped-literal path nobody tests.
 */
function isProbeableTableName(table: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table);
}

/**
 * The catalog statement that answers "is this table here?" WITHOUT raising when
 * the answer is no, or `undefined` when none can be compiled.
 *
 * Each arm returns one row when the relation exists and ZERO rows when it does
 * not — never an error, which is the whole point. Exported for the pins: the
 * text is what the live PG and MySQL arms are asserted on.
 */
export function buildTablePresenceSql(table: string, client?: string): string | undefined {
  if (!isProbeableTableName(table)) return undefined;
  switch (catalogFamilyOf(client)) {
    case 'sqlite':
      // `sqlite_master` is the per-connection catalog; temp tables live in
      // `sqlite_temp_master` and are deliberately not counted — nothing this
      // package provisions is temporary.
      return `SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = '${table}'`;
    case 'postgres':
      // `to_regclass` resolves through `search_path`, which is exactly how the
      // driver's own unqualified statements resolve, and answers NULL rather
      // than raising for a name that is not there. The quoted argument makes the
      // match exact instead of case-folded.
      return `SELECT 1 WHERE to_regclass('"${table}"') IS NOT NULL`;
    case 'mysql':
      // `DATABASE()` scopes to the connected schema — `information_schema.tables`
      // without it can see a same-named table in another schema on the server.
      return (
        `SELECT 1 FROM information_schema.tables ` +
        `WHERE table_schema = DATABASE() AND table_name = '${table}'`
      );
    default:
      return undefined;
  }
}

/**
 * What a presence probe found. FOUR verdicts, ⛔ not a boolean.
 *
 * `'absent'` is an ANSWER — the catalog was read and the table is not in it.
 * `'unreadable'` is a REPORT — the probe could not run, so nothing is known. The
 * distinction is the fence in this module's header: folding the second into the
 * first is how a mis-compiled arm turns a data repair into a silent no-op.
 */
export type TablePresenceVerdict =
  /** The catalog named the relation (or the fallback probe ran and did not refuse). */
  | 'present'
  /** The probe ANSWERED, and the relation is not there. The expected miss. */
  | 'absent'
  /**
   * The seam accepted the statement and returned no result set at all — a
   * memory engine's no-op `execute` (#10789). Not a failure and not an answer;
   * each caller maps it the way its own history already ruled.
   */
  | 'no-answer'
  /** ⛔ The probe itself failed, for a reason that is not "no such table". */
  | 'unreadable';

export interface TablePresenceResult {
  verdict: TablePresenceVerdict;
  /** Which arm ran — pinned, so "the catalog arm was taken" is checkable. */
  probe: 'catalog' | 'fallback';
  /** Operator-facing reason. Set for `'no-answer'` and `'unreadable'` only. */
  detail?: string;
}

export interface TablePresenceProbe {
  /**
   * The table whose presence is asked. Also the `readObject` the fallback arm's
   * classification compares the dialect's phrase against, so a refusal naming
   * some OTHER relation is ⛔ not read as this table's absence (#13324).
   */
  table: string;
  /** The knex client name, when the caller resolved one. */
  client?: string;
  /**
   * The caller's own pre-#17175 `SELECT … WHERE 1 = 0` statement, used ONLY when
   * no catalog arm can be compiled. Taken from the caller rather than built here
   * so each site keeps the exact statement its own pins and dialect review
   * already cover.
   */
  fallbackSql: string;
}

/**
 * Ask whether a table is there, without raising when it is not.
 *
 * @see the module header for the fence this implements, and for why an
 *      unrecognised dialect keeps the caller's raising probe instead of getting
 *      a guessed catalog statement.
 */
export async function readTablePresence(
  exec: ReadProbeExec,
  probe: TablePresenceProbe,
): Promise<TablePresenceResult> {
  const catalogSql = buildTablePresenceSql(probe.table, probe.client);

  if (catalogSql !== undefined) {
    let result: unknown;
    try {
      result = await exec(catalogSql);
    } catch (error) {
      // ⛔ THE FENCE. A catalog statement this helper compiled and the backend
      // refused is a defect in this helper, not evidence about the table. It is
      // never `'absent'`, and the caller is required to report it.
      return {
        verdict: 'unreadable',
        probe: 'catalog',
        detail:
          operatorFacingErrorText(error) ||
          `the table-presence catalog probe for '${probe.table}' was refused`,
      };
    }
    if (!isResultSet(result)) {
      return { verdict: 'no-answer', probe: 'catalog', detail: SEAM_NO_ANSWER_DETAIL };
    }
    return {
      verdict: normalizeRows(result).length > 0 ? 'present' : 'absent',
      probe: 'catalog',
    };
  }

  // No catalog arm for this client. The caller's own probe runs, exactly as it
  // did before #17175 — it still raises on a missing table, and the driver still
  // prints one line — but the refusal is now classified rather than conflated.
  try {
    const result = await exec(probe.fallbackSql);
    if (!isResultSet(result)) {
      return { verdict: 'no-answer', probe: 'fallback', detail: SEAM_NO_ANSWER_DETAIL };
    }
    return { verdict: 'present', probe: 'fallback' };
  } catch (error) {
    if (isMissingTableError(error, probe.table)) {
      return { verdict: 'absent', probe: 'fallback' };
    }
    return {
      verdict: 'unreadable',
      probe: 'fallback',
      detail:
        operatorFacingErrorText(error) ||
        `the table-presence probe for '${probe.table}' was refused`,
    };
  }
}

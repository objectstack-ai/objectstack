// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The REMOTE-mode canonical temporal backfill (objectstack#5770, cloud#1005).
 *
 * `SqlDriver.backfillCanonicalDatetimes` / `backfillCanonicalTimes` converge a
 * SQLite table's `Field.datetime` / `Field.time` columns on the canonical
 * storage form (#3912 / #3994) and then mark the column clean, which is what
 * lets `needsLegacyDatetimeRepair` drop the read-side repair expression and
 * emit a plain, INDEXABLE `col >= ?` again. Both are Knex paths. TursoDriver's
 * remote mode never touches Knex — its DDL and CRUD go out over
 * `@libsql/client` (see `RemoteTransport`) — so in remote mode the backfill has
 * never run, `canonicalDatetimeFields` / `canonicalTimeFields` stay empty, and
 * every temporal filter compiles to the unindexable repair CASE forever. Local
 * mode has an exit from that cost; remote had none. This module is that exit.
 *
 * ## What it is NOT
 *
 * It is NOT a correctness prerequisite. ADR-0053 D-B3 / cloud#1003 fix the
 * posture: reads and writes are correct whether or not a backfill has ever run,
 * because the read-side repair is always there until a column is PROVED
 * canonical. Everything here is a performance exit, and every failure mode
 * below degrades to "column stays unmarked, reads keep the repair, answers stay
 * correct" — never to a wrong answer and never to a failed boot.
 *
 * ## Batched, resumable, and marked only when proved (the maintainer's 方案 1)
 *
 * - **Batched.** Each phase converts at most `batchSize` rows per statement,
 *   selected by `rowid` (`RemoteTransport.buildCreateTableSQL` never emits
 *   `WITHOUT ROWID`, so every table it makes has one). `UPDATE ... LIMIT`
 *   needs a compile-time option libSQL does not promise, so the limit rides on
 *   a `rowid IN (SELECT ... LIMIT n)` subquery, which is portable SQLite.
 * - **Resumable.** No checkpoint state exists or is needed: the WHERE guard
 *   selects exactly the rows that are not yet canonical, so a run interrupted
 *   anywhere leaves converted rows converted and the next run picks up the
 *   remainder. Re-running a converged column costs one statement and zero
 *   writes.
 * - **Marked only when proved.** The column is reported `canonical` only when a
 *   post-pass probe measures nothing left for either phase to change. A run
 *   stopped by its batch budget, or by an error, reports `canonical: false` and
 *   the caller leaves the repair in place. This is stricter than the local twin,
 *   which marks clean on a successful `UPDATE` because that statement is
 *   unbatched and therefore total.
 *
 *   "Nothing left to change" deliberately takes TWO counts, not one. An
 *   un-converted TEXT epoch is a FIXPOINT of the shared repair (see 后果 B
 *   below), so a table of nothing but legacy epoch rows measures zero residual
 *   and would look finished. Gating on that alone would mark the column, drop
 *   the repair, and — because a marked column is skipped on the next run —
 *   strand exactly the rows this module exists to rescue. The in-band epoch
 *   count is therefore part of the gate.
 *
 * ## The 后果 B limb — TEXT-affinity numeric epochs, handled HERE and only here
 *
 * `RemoteTransport.mapFieldTypeToSQL` declares every temporal column `TEXT`, so
 * the pre-#942 remote write path (which passed a bound number through verbatim)
 * left epoch milliseconds on disk as TEXT — measured as `'1753660800000.0'`.
 * The shared repair dispatches on `typeof(col) in ('integer','real')`, a branch
 * a TEXT-affinity column can never take, and `strftime` cannot parse that
 * string either, so `coalesce` hands the original back: the row is a fixpoint
 * of the repair, is never converged, and is compared as TEXT. It is not
 * invisible — it is worse: `'1753660800000.0'` sorts before `'2025-…'`, so the
 * row is missed by the window it belongs to AND matched by windows it does not.
 *
 * The maintainer's 2026-08-03 ruling on cloud#1005 REJECTED teaching the shared
 * `@objectstack/driver-sql` expression to recognise epoch-looking numeric text
 * (option 3): that expression is a public contract for every SQLite consumer
 * and runs on every read, where the heuristic would misread a legitimate
 * numeric-string column. The same recovery is safe here, and the difference is
 * not a matter of degree:
 *
 *   - it runs ONCE, as an explicit migration, not on every read;
 *   - it only ever touches a column the METADATA declares `Field.datetime` or
 *     `Field.time` — the shape is not guessed from the value;
 *   - a digits-only string is not a spelling of any canonical temporal value,
 *     so in such a column it is unambiguously a pre-#942 write;
 *   - it is bounded to a plausible epoch-millisecond band and re-checked to
 *     have produced TEXT before a single row is written.
 *
 * Rows outside that band are LEFT ALONE and counted into
 * `unresolvedEpochTextRows` rather than guessed at — the "不可解残留如实记录"
 * half of the ruling.
 *
 * ⛔ Whether such a row may ride through the canonical mark is NOT uniform over
 * that remainder, and an earlier version of this paragraph said it was. It
 * depends on where the value sits relative to SQLite's julian-day range, and
 * both halves are measured below.
 *
 * ## The julian-day limb — the one shape `coalesce` does NOT preserve (#6009)
 *
 * The convergence phase leans on `coalesce(strftime(…), col)` to hand back what
 * it cannot parse. That has one hole, and it is not a NULL: SQLite's time-value
 * grammar accepts a bare number as a JULIAN DAY (`DDDD.DDDD`, the last of its
 * documented formats) and the keyword `now`. For those two shapes `strftime`
 * answers confidently rather than returning NULL, so `coalesce` never fires and
 * the `UPDATE` would write that answer OVER the stored bytes, irrecoverably —
 * the one thing the backfill contract promises it never does. Measured on
 * better-sqlite3 13.0.3 / SQLite 3.53.4 with the column declared `TEXT`:
 *
 * ```text
 * '2026'  -> -4707-06-11T12:00:00.000Z    'now' -> the wall clock, now
 * '86400' -> -4476-06-15T12:00:00.000Z    '12'  -> -4713-12-06T12:00:00.000Z
 * ```
 *
 * `SqlDriver.sqliteNonTemporalTextSql` is the structural COMPLEMENT of the
 * parseable spellings — every other format the parser accepts goes through
 * `YYYY-MM-DD` or `HH:MM`, so it carries a `-` or a `:` — and the driver hands
 * it across this boundary exactly as it hands the canonical expression. Rows it
 * matches are withheld from the convergence `UPDATE` and reported in
 * `nonTemporalTextRowsWithheld`.
 *
 * ⭐ **A withheld row also BLOCKS the canonical mark**, and that half is what
 * keeps every query answer identical. Withholding alone would not: the row
 * keeps its original bytes, and a column marked clean drops the read-side
 * repair, so `'2026'` would start comparing as raw TEXT instead of as the
 * instant the repair reads it as. Unlike the `coalesce` fixpoints these rows
 * are NOT invariant under the repair, so they cannot ride the mark. Here that
 * costs no second gate: such a row is by construction `col IS NOT canonical`,
 * so it is already inside `residual`, and the mark requires `residual === 0`.
 *
 * ## Where the two bands sit — measured, and they do not meet
 *
 * A bare number is read as a julian day only for `0 <= v < 5373484.5`
 * (`'5373484.4'` parses, `'5373484.5'` returns NULL). The 后果 B recovery band
 * is `1e12 <= v < 4.1024448e12`. The julian ceiling is five orders of magnitude
 * BELOW the epoch floor, so the two sets are disjoint with a wide gap and the
 * guard cannot withhold a single row the epoch recovery would convert. That
 * also splits the "unresolvable remainder" in two:
 *
 *   - `v >= 5373484.5` — including everything at or above the epoch band, where
 *     `strftime` returns NULL: a genuine fixpoint. Reading it with the repair
 *     and without it give the identical answer, so it rides through the mark.
 *   - `v < 5373484.5`: NOT a fixpoint. It is withheld, counted, and it holds the
 *     mark back. `'12'`, `'2026'` and `'86400'` are all in this half.
 *
 * ## One definition of "canonical"
 *
 * This module never spells the repair expression, and it never spells the guard
 * either. The caller passes the driver's own `sqliteCanonicalDatetimeSql` /
 * `sqliteCanonicalTimeSql` and its own `sqliteNonTemporalTextSql` in — together,
 * as {@link RemoteBackfillSqlRules} — so the SET expression, the WHERE guard,
 * the convergence probe and the read path are the same rule by construction and
 * cannot drift, the property the local twin's contract calls out, kept across
 * the transport boundary.
 */

// [#14287] The unsafe-identifier refusal's ADR-0112 envelope, from the one
// place that decides it. Imported rather than re-spelled so this module and
// `RemoteTransport` cannot answer one condition two ways; `turso-driver.ts`
// already loads both modules together, so the edge costs nothing at runtime.
import { unsafeIdentifierError } from './remote-transport.js';

/** The `@libsql/client` surface this module uses — nothing more. */
export interface RemoteBackfillClient {
  execute(stmt: { sql: string; args?: unknown[] } | string): Promise<{
    rows: unknown[];
    rowsAffected: number;
  }>;
  batch(
    stmts: Array<{ sql: string; args?: unknown[] } | string>,
    mode?: string,
  ): Promise<Array<{ rows: unknown[]; rowsAffected: number }>>;
}

/** Minimal log sink — the driver hands its own in. */
export interface RemoteBackfillLogger {
  warn: (msg: string, meta?: unknown) => void;
  info?: (msg: string, meta?: unknown) => void;
}

/** Which canonical form a column is being converged on. */
export type RemoteBackfillKind = 'datetime' | 'time';

/** A column to converge, and the driver's rule for reading it canonically. */
export interface RemoteBackfillColumn {
  table: string;
  field: string;
  kind: RemoteBackfillKind;
}

/**
 * Renders the driver's canonical-read expression around an arbitrary SQL
 * column reference — `SqlDriver.sqliteCanonicalDatetimeSql` /
 * `sqliteCanonicalTimeSql`, handed in rather than copied.
 */
export type CanonicalSqlFor = (kind: RemoteBackfillKind, columnSql: string) => string;

/**
 * Renders the driver's #6009 backfill-side guard around an arbitrary SQL column
 * reference — `SqlDriver.sqliteNonTemporalTextSql`, handed in rather than
 * copied, for the reason the module contract gives: one rule, two transports.
 *
 * Kind-free on purpose. The predicate probes parseability with `julianday()`
 * rather than a format string, so the identical expression serves the datetime
 * and the time column.
 *
 * ⛔ It is a WRITE-side guard and belongs nowhere near a read path. The
 * maintainer's 2026-08-03 ruling on cloud#1005 refused teaching the shared read
 * expression to recognise numeric-looking text; everything reached through this
 * type runs once, as a migration, and only ever declines to write.
 */
export type NonTemporalTextSqlFor = (columnSql: string) => string;

/** Both SQL rules this module borrows from the driver, in one place. */
export interface RemoteBackfillSqlRules {
  /** {@link CanonicalSqlFor} — what "canonical" means, for both phases. */
  canonical: CanonicalSqlFor;
  /** {@link NonTemporalTextSqlFor} — which rows the convergence may not write. */
  nonTemporalText: NonTemporalTextSqlFor;
}

/**
 * What every entry point takes in its third position.
 *
 * {@link RemoteBackfillSqlRules} is the shape to pass. A bare
 * {@link CanonicalSqlFor} is the pre-#6009 spelling, still accepted so that no
 * caller compiled against the earlier release stops compiling — and it is
 * FAIL-CLOSED, ⛔ not a fallback: with no guard to withhold by, the convergence
 * `UPDATE` is refused rather than run unguarded, the column reports `error` and
 * stays unmarked, and the read-side repair keeps every answer correct. The
 * 后果 B epoch recovery still runs on that arm; it is structurally out of the
 * guard's reach either way (see the reading beside its statement).
 *
 * ⛔ The bare arm is a compatibility surface with a shelf life, not a second
 * supported way to call this module.
 */
export type RemoteBackfillSql = CanonicalSqlFor | RemoteBackfillSqlRules;

/** What a caller supplied, with "no guard" said once instead of at four sites. */
interface ResolvedBackfillSql {
  canonical: CanonicalSqlFor;
  /** `null` when the caller passed the bare pre-#6009 arm. */
  nonTemporalText: NonTemporalTextSqlFor | null;
}

const resolveBackfillSql = (sql: RemoteBackfillSql): ResolvedBackfillSql =>
  typeof sql === 'function'
    ? { canonical: sql, nonTemporalText: null }
    : { canonical: sql.canonical, nonTemporalText: sql.nonTemporalText };

/**
 * What a column reports when it was asked to converge without the guard.
 * It names the fix, because the caller here is code rather than an operator.
 *
 * #6009 — the tracker id stays in this comment, never in the string: nothing
 * that reaches an operator's log can resolve one.
 */
const GUARD_NOT_SUPPLIED =
  'remote canonical backfill: refusing to converge without the non-temporal-text ' +
  'guard — pass { canonical, nonTemporalText } (the driver\'s ' +
  'sqliteCanonicalDatetimeSql / sqliteCanonicalTimeSql and sqliteNonTemporalTextSql) ' +
  'instead of a bare canonical expression. Reads stay correct: the column keeps its ' +
  'read-side repair.';

export interface RemoteCanonicalBackfillOptions {
  /**
   * Rows rewritten per `UPDATE` statement. Default
   * {@link REMOTE_BACKFILL_DEFAULT_BATCH_SIZE}.
   */
  batchSize?: number;
  /**
   * Maximum `UPDATE` statements per phase per column in ONE invocation —
   * the budget that keeps an automatic run from turning a huge legacy table
   * into an unbounded boot. Default {@link REMOTE_BACKFILL_DEFAULT_MAX_BATCHES}.
   * Exhausting it is not a failure: the column stays unmarked, the reads stay
   * repaired, and the next invocation resumes exactly where this one stopped.
   */
  maxBatches?: number;
}

/** What one column's convergence attempt actually did. */
export interface RemoteBackfillColumnReport extends RemoteBackfillColumn {
  /** Rows rewritten by the TEXT-affinity epoch recovery (后果 B). */
  epochTextRowsConverted: number;
  /** Rows rewritten by the shared canonical convergence (后果 A). */
  rowsConverted: number;
  /** Rows still not a fixpoint of the shared repair when this run stopped. */
  residualRows: number;
  /**
   * In-band epoch-text rows still awaiting conversion when this run stopped —
   * nonzero only when a batch budget or an error cut the run short. Blocks the
   * canonical mark: these rows ARE convertible, and a marked column is skipped
   * next time.
   */
  pendingEpochTextRows: number;
  /**
   * Digits-only TEXT rows this run deliberately declined to interpret because
   * they fall outside {@link REMOTE_BACKFILL_EPOCH_MS_MIN} …
   * {@link REMOTE_BACKFILL_EPOCH_MS_MAX} — the unresolvable remainder of 后果 B,
   * recorded rather than guessed at.
   *
   * ⚠️ **This count is not uniform in its effect on the mark, and the sentence
   * that used to say it was ("does NOT block the canonical mark: such a row is
   * a fixpoint of the shared repair") is true of only one of its two halves.**
   * It is true ABOVE SQLite's julian-day ceiling — `strftime` returns NULL
   * there, `coalesce` hands the value back, and reading the row with the repair
   * and without it give the identical answer. It is FALSE below that ceiling:
   * `'2026'`, `'86400'` and `'12'` are read as BC dates, so dropping the repair
   * changes what they match. Those rows are ALSO counted in
   * {@link nonTemporalTextRowsWithheld}, they stay inside `residualRows`, and
   * they therefore DO hold the mark back. The two counts deliberately overlap;
   * neither is a subset of the other, because the guard also catches shapes
   * this count never sees (a leading `+` or space, `'2026e0'`, a digits-only
   * BLOB).
   */
  unresolvedEpochTextRows: number;
  /**
   * Rows the #6009 guard withheld from the convergence `UPDATE` because
   * SQLite's date functions ANSWER for them without their being a spelling of
   * any temporal literal — the julian-day limb and the `now` keyword.
   * Canonicalising one would overwrite the stored bytes with a date nobody
   * wrote, and no later run could get them back.
   *
   * Blocks the canonical mark, without needing its own gate: a withheld row is
   * by construction not a fixpoint of the shared repair, so it is already
   * inside `residualRows`, which the mark requires to be zero. The column keeps
   * its (unindexed) read-side repair and every query answer is bit-for-bit what
   * it was before this run — the same degradation a failed `UPDATE` takes.
   *
   * `null` means NOT MEASURED — the caller passed the bare pre-#6009
   * {@link RemoteBackfillSql} arm, so there was no guard to count with and the
   * convergence was refused rather than run. ⛔ It is never reported as `0`:
   * a zero from an instrument that never ran is a claim about the instrument.
   */
  nonTemporalTextRowsWithheld: number | null;
  /**
   * The column is PROVED converged: no row is left for either phase to change,
   * so the caller may drop the read-side repair. `false` whenever that was not
   * measured, for any reason at all.
   */
  canonical: boolean;
  /** A batch budget stopped this run before convergence. */
  budgetExhausted: boolean;
  /** Present when the column was skipped because a statement failed. */
  error?: string;
}

export interface RemoteCanonicalBackfillReport {
  columns: RemoteBackfillColumnReport[];
}

/** Rows rewritten per `UPDATE`. */
export const REMOTE_BACKFILL_DEFAULT_BATCH_SIZE = 500;

/** `UPDATE` statements per phase per column, per invocation. */
export const REMOTE_BACKFILL_DEFAULT_MAX_BATCHES = 20;

/**
 * The band of digits-only values the 后果 B recovery will interpret as epoch
 * MILLISECONDS, inclusive lower / exclusive upper: 2001-09-09 through
 * 2100-01-01.
 *
 * The floor is chosen for one reason and it is not cosmetic. A digits-only
 * string is only *unambiguously* milliseconds once it is too large to be a
 * plausible epoch-SECONDS value: seconds for any instant before 2100 are at
 * most ~4.1e9, so a floor of 1e12 puts every one of them out of band. Without
 * it, `'1753660800'` (2025-07-28 in seconds) would be read as milliseconds and
 * silently rewritten to 1970-01-21 — measured, and exactly the kind of
 * irreversible mis-repair the maintainer refused to put in the shared
 * expression.
 *
 * Values outside the band are LEFT ON DISK and counted, never guessed at.
 */
export const REMOTE_BACKFILL_EPOCH_MS_MIN = 1_000_000_000_000;
export const REMOTE_BACKFILL_EPOCH_MS_MAX = 4_102_444_800_000;

/**
 * Identifiers are INLINED into these statements (SQLite cannot bind an
 * identifier), so every one is checked against the same allowlist
 * `RemoteTransport` uses for its DDL before it reaches a string template.
 */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * [#14287] The second producer of the transport's unsafe-identifier refusal,
 * carrying the identical ADR-0112 envelope — `INVALID_REQUEST` / 400 — through
 * the one constructor that decides it ({@link unsafeIdentifierError}). One
 * condition, one wire answer, whichever of the two helpers refused it.
 *
 * ## Measured: on THIS module's paths the envelope is defence in depth, not a
 * ## wire answer — and saying so is the point
 *
 * Both callers flatten the throw by design: {@link probeRemoteCanonicalColumns}
 * turns it into `{ error: message }` and {@link backfillRemoteCanonicalColumn}
 * into `report.error`, because ADR-0053 D-B3 forbids a migration from taking a
 * boot down. So `code` and `status` reach no response envelope from here today
 * — only the MESSAGE survives, into the report a caller logs. The envelope is
 * still worth carrying, for two reasons and no third: the two producers of one
 * condition must not drift onto two spellings (the card's own "decide the code
 * once" argument), and a future caller that propagates instead of reporting
 * inherits the right answer rather than re-deriving one.
 *
 * ⛔ It is therefore NOT the wire-reachability evidence for this package's
 * ledger provenance row — `RemoteTransport`'s DDL and `aggregate` positions
 * are, and they answer over HTTP. Exported so the envelope has a real pin: no
 * exported path can observe it, and an unobservable assertion is the phantom
 * check `AGENTS.md` names rather than a test.
 */
export function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw unsafeIdentifierError(`remote canonical backfill: unsafe identifier rejected: "${name}"`);
  }
}

/**
 * "This TEXT value is a digits-only string" — the SHAPE half of the 后果 B
 * guard, with no opinion yet on whether it is interpretable.
 *
 * `GLOB '[0-9]*'` requires a leading digit and `NOT GLOB '*[^0-9.]*'` forbids
 * every character but digits and the decimal point, so no canonical temporal
 * spelling can match: an ISO instant carries `-`, `:`, `T` and `Z`, and a
 * canonical wall clock carries `:`.
 */
function epochTextShapeSql(columnSql: string): string {
  return (
    `${columnSql} is not null and typeof(${columnSql}) = 'text' ` +
    `and ${columnSql} glob '[0-9]*' and ${columnSql} not glob '*[^0-9.]*'`
  );
}

/** {@link epochTextShapeSql} plus the plausible-epoch-millisecond band. */
function epochTextInBandSql(columnSql: string): string {
  return (
    `${epochTextShapeSql(columnSql)} ` +
    `and cast(${columnSql} as real) >= ${REMOTE_BACKFILL_EPOCH_MS_MIN} ` +
    `and cast(${columnSql} as real) < ${REMOTE_BACKFILL_EPOCH_MS_MAX}`
  );
}

/**
 * "This row is not yet canonical" — the same null-safe, type-aware `IS NOT`
 * guard the local twin uses as its whole WHERE, over the driver's own
 * expression.
 */
function notCanonicalSql(columnSql: string, canonicalSql: string): string {
  return `${columnSql} is not null and ${columnSql} is not ${canonicalSql}`;
}

const readCount = (result: { rows: unknown[] }, key: string): number => {
  const row = result.rows[0] as Record<string, unknown> | undefined;
  const raw = row?.[key];
  return typeof raw === 'number' ? raw : Number(raw ?? 0) || 0;
};

/**
 * One statement that measures everything a decision needs.
 *
 * FOUR counts, and neither of the last two is decoration.
 *
 * `residual` alone cannot decide the completion marker, because a TEXT epoch is
 * a FIXPOINT of the shared repair — `strftime` declines it and `coalesce` hands
 * it back — so a table of nothing but un-converted 后果 B rows measures
 * `residual = 0`. Marking on that would declare the column done, drop the
 * repair, and (because a marked column is skipped on the next run) strand those
 * rows on the legacy form permanently. `epoch_in_band` is what remains to be
 * converted; the mark waits for it.
 *
 * `non_temporal_text` (#6009) is the OTHER direction: rows that ARE inside
 * `residual` and that the convergence `UPDATE` will nevertheless not rewrite,
 * because doing so would overwrite their bytes with a julian-day misreading. It
 * is measured as the migration's own `WHERE` with the guard ANDed on instead of
 * negated, so what this counts and what the `UPDATE` skips are one expression by
 * construction — the same construction the local twin's
 * `countNonTemporalTextRows` uses, for the same reason. `residual` MINUS this is
 * therefore exactly the work an apply will do, which is what lets the probe
 * promise neither more nor less than the `UPDATE` performs.
 *
 * ⛔ It is deliberately NOT subtracted out of `residual` itself: a withheld row
 * is genuinely not a fixpoint of the repair, so it must keep holding the
 * canonical mark back. Netting it out here is the one edit that would silently
 * re-open #6009 from the other side.
 *
 * This is also the whole cost of re-running against a converged table — the
 * counts come back zero and nothing is written.
 */
function buildProbeSql(column: RemoteBackfillColumn, sql: ResolvedBackfillSql): string {
  assertSafeIdentifier(column.table);
  assertSafeIdentifier(column.field);
  const col = `"${column.field}"`;
  const canonical = sql.canonical(column.kind, col);
  // Omitted entirely on the bare arm rather than emitted as a zero: the
  // statement's shape is then the honest record of what was measured, and
  // `readProbe` reports `null` for what it did not ask.
  const guarded = sql.nonTemporalText
    ? `, sum(case when ${notCanonicalSql(col, canonical)} and ${sql.nonTemporalText(col)} ` +
      `then 1 else 0 end) as non_temporal_text`
    : '';
  return (
    `select ` +
    `sum(case when ${notCanonicalSql(col, canonical)} then 1 else 0 end) as residual, ` +
    `sum(case when ${epochTextShapeSql(col)} then 1 else 0 end) as epoch_text, ` +
    `sum(case when ${epochTextInBandSql(col)} then 1 else 0 end) as epoch_in_band` +
    `${guarded} ` +
    `from "${column.table}"`
  );
}

/** What one probe statement measured. */
interface RemoteBackfillProbe {
  /**
   * Rows that are not a fixpoint of the shared repair — the mark's gate.
   * INCLUDES {@link nonTemporalText}, which the `UPDATE` will not rewrite.
   */
  residual: number;
  /** Rows carrying the digits-only TEXT shape, in band or not. */
  epochText: number;
  /** Rows the 后果 B recovery will interpret — the work still outstanding. */
  epochInBand: number;
  /**
   * Rows inside {@link residual} that the #6009 guard withholds from the
   * `UPDATE`. `residual - nonTemporalText` is the work an apply performs.
   * `null` when no guard was supplied — NOT MEASURED, never `0`.
   */
  nonTemporalText: number | null;
}

const readProbe = (result: { rows: unknown[] }, guarded: boolean): RemoteBackfillProbe => ({
  residual: readCount(result, 'residual'),
  epochText: readCount(result, 'epoch_text'),
  epochInBand: readCount(result, 'epoch_in_band'),
  nonTemporalText: guarded ? readCount(result, 'non_temporal_text') : null,
});

/**
 * The rows an apply will actually rewrite in the convergence phase — the
 * probe's promise, stated once so the decision to run the phase and the plan a
 * caller reads cannot disagree. `null` when the guard was not supplied, which
 * is the one answer that must not be read as "no work": there it means the
 * phase cannot run at all.
 */
const convertibleResidual = (probe: RemoteBackfillProbe): number | null =>
  probe.nonTemporalText === null ? null : Math.max(0, probe.residual - probe.nonTemporalText);

/**
 * Probe every column in ONE round-trip.
 *
 * Boot calls this for all of a driver's temporal columns at once; on a database
 * that is already converged (the steady state) that single batch is the entire
 * cost of the backfill, and nothing else in this module runs.
 *
 * This is also the remote side's whole PREVIEW surface. `SqlDriver`'s
 * `previewDeferredSchemaWork` reads `deferredSchemaObjects`, which only the Knex
 * sync path fills, so in remote mode it answers `[]` and this probe is the only
 * thing that can say what an apply would rewrite. It therefore owes the same
 * obligation `previewDatetimeConvergence` owes locally — promise exactly the
 * rows the `UPDATE` touches, #6009 exclusion included — which is what
 * `residual - nonTemporalText` is for.
 */
export async function probeRemoteCanonicalColumns(
  client: RemoteBackfillClient,
  columns: RemoteBackfillColumn[],
  sql: RemoteBackfillSql,
): Promise<Array<RemoteBackfillProbe | { error: string }>> {
  if (columns.length === 0) return [];
  const rules = resolveBackfillSql(sql);
  const guarded = rules.nonTemporalText !== null;
  let stmts: string[];
  try {
    stmts = columns.map((c) => buildProbeSql(c, rules));
  } catch (err) {
    // An unsafe identifier anywhere in the set — report per column and let
    // `backfillRemoteCanonicalColumn` re-raise it for the offending one.
    const message = err instanceof Error ? err.message : String(err);
    return columns.map(() => ({ error: message }));
  }
  try {
    const results = await client.batch(stmts, 'read');
    return results.map((r) => readProbe(r, guarded));
  } catch {
    // A batch is all-or-nothing; fall back to per-column probes so one
    // unreadable table (dropped, permission-denied) cannot mask the rest.
    const out: Array<RemoteBackfillProbe | { error: string }> = [];
    for (let i = 0; i < columns.length; i++) {
      try {
        out.push(readProbe(await client.execute(stmts[i]), guarded));
      } catch (inner) {
        out.push({ error: inner instanceof Error ? inner.message : String(inner) });
      }
    }
    return out;
  }
}

/**
 * Run one batched `UPDATE` phase until it converges, the budget runs out, or a
 * statement stops making progress.
 *
 * Returns the rows rewritten and whether the budget was the reason it stopped.
 * The no-progress break is a safety valve, not an expected path: each batch
 * turns the rows it selects into fixpoints of the guard, so the matching set
 * strictly shrinks and the loop terminates on its own.
 */
async function runBatchedUpdate(
  client: RemoteBackfillClient,
  updateSql: string,
  batchSize: number,
  maxBatches: number,
): Promise<{ rowsConverted: number; budgetExhausted: boolean }> {
  let rowsConverted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const res = await client.execute({ sql: updateSql, args: [batchSize] });
    const affected = res.rowsAffected ?? 0;
    rowsConverted += affected;
    // Short of the limit means the guard had nothing more to match, so the
    // phase is done — and a zero-row batch is the same statement, said once.
    if (affected < batchSize) return { rowsConverted, budgetExhausted: false };
  }
  return { rowsConverted, budgetExhausted: true };
}

/**
 * Converge ONE column and report what happened — the unit every caller
 * ultimately goes through.
 *
 * Phase order is load-bearing: the 后果 B recovery runs FIRST so the rows it
 * rewrites are already canonical text by the time the shared convergence sweeps,
 * which then finds them fixpoints and does not touch them again.
 *
 * TWO statements write here, and #6009 lands on exactly one of them. The
 * convergence `UPDATE` carries the guard; the epoch-text `UPDATE` is
 * structurally out of its reach — see the reading beside that statement.
 */
export async function backfillRemoteCanonicalColumn(
  client: RemoteBackfillClient,
  column: RemoteBackfillColumn,
  sql: RemoteBackfillSql,
  options: RemoteCanonicalBackfillOptions = {},
  probed?: RemoteBackfillProbe,
): Promise<RemoteBackfillColumnReport> {
  const rules = resolveBackfillSql(sql);
  const batchSize = Math.max(1, options.batchSize ?? REMOTE_BACKFILL_DEFAULT_BATCH_SIZE);
  const maxBatches = Math.max(1, options.maxBatches ?? REMOTE_BACKFILL_DEFAULT_MAX_BATCHES);

  const base: RemoteBackfillColumnReport = {
    ...column,
    epochTextRowsConverted: 0,
    rowsConverted: 0,
    residualRows: 0,
    pendingEpochTextRows: 0,
    unresolvedEpochTextRows: 0,
    nonTemporalTextRowsWithheld: null,
    canonical: false,
    budgetExhausted: false,
  };

  try {
    // Inside the `try` on purpose: a rejected identifier is REPORTED like every
    // other failure, so the caller's response is the same one it has for an
    // unreachable remote — leave the read-side repair on — rather than an
    // exception that could take a boot down (D-B3).
    assertSafeIdentifier(column.table);
    assertSafeIdentifier(column.field);
    const table = `"${column.table}"`;
    const col = `"${column.field}"`;
    const canonical = rules.canonical(column.kind, col);
    // [#6009] The driver's own backfill-side guard, handed across exactly as the
    // canonical expression is. It never reaches a read path. `null` on the bare
    // pre-#6009 arm, which is refused below rather than run unguarded.
    const guard = rules.nonTemporalText ? rules.nonTemporalText(col) : null;
    // Reading the TEXT epoch AS A NUMBER is the whole trick: `cast(col as real)`
    // makes `typeof()` report 'real', so the driver's OWN expression takes its
    // integer/real branch and produces the canonical form. The recovery therefore
    // reuses the shared rule instead of restating the epoch conversion.
    const canonicalFromEpochText = rules.canonical(column.kind, `cast(${col} as real)`);

    const probe =
      probed ??
      readProbe(await client.execute(buildProbeSql(column, rules)), guard !== null);

    // Fast path — and the steady state. A converged column, and a table this
    // very boot created (its counts are NULL, hence zero), costs one statement
    // and no writes, and is marked canonical on measured evidence rather than
    // on the assumption that it must be empty. Out-of-band digits-only rows are
    // reported but do not hold the mark back — see the field's contract.
    if (probe.residual === 0 && probe.epochInBand === 0) {
      return {
        ...base,
        canonical: true,
        unresolvedEpochTextRows: probe.epochText,
        // Measured on this same statement (0 when the guard ran and found
        // nothing), and `null` when the bare arm never asked.
        nonTemporalTextRowsWithheld: probe.nonTemporalText,
      };
    }

    if (probe.epochInBand > 0) {
      // The extra `typeof(...) = 'text'` on the produced value is belt-and-braces
      // over the band: no row is rewritten unless the expression has actually
      // yielded a string for it, so a `strftime` that declined can never write a
      // bare number into a temporal column.
      //
      // [#6009] This statement does NOT carry the julian guard, and that is a
      // reading rather than an omission. Two independent reasons, either alone
      // sufficient:
      //
      //   1. Its SET expression wraps `cast(col as real)`, whose `typeof()` is
      //      ALWAYS 'real', so the canonical expression takes its integer/real
      //      limb — `strftime(…, v/1000.0, 'unixepoch')`. The julian misreading
      //      lives only in the `else` limb's `strftime(…, col)`, which this
      //      statement can never reach, whatever the row holds.
      //   2. Its WHERE selects digits-only text in `1e12 … 4.1024448e12`, and a
      //      bare number is read as a julian day only below 5373484.5. The two
      //      sets are disjoint by five orders of magnitude, so ANDing the guard
      //      on here would withhold nothing and would falsely imply they meet.
      const epochSql =
        `update ${table} set ${col} = ${canonicalFromEpochText} where rowid in (` +
        `select rowid from ${table} where ${epochTextInBandSql(col)} ` +
        `and typeof(${canonicalFromEpochText}) = 'text' limit ?)`;
      const phase = await runBatchedUpdate(client, epochSql, batchSize, maxBatches);
      base.epochTextRowsConverted = phase.rowsConverted;
      base.budgetExhausted ||= phase.budgetExhausted;
    }

    const convertible = convertibleResidual(probe);
    if (guard === null) {
      // FAIL-CLOSED. Without the guard there is no way to tell a julian-only
      // cell from an ordinary legacy one, so this phase does not run at all —
      // ⛔ never "run it and hope". The epoch limb above already ran, because it
      // is out of the guard's reach in both directions. `residual > 0` rather
      // than `!== 0` on purpose: a converged column has nothing to refuse and
      // still reports cleanly.
      if (probe.residual > 0) base.error = GUARD_NOT_SUPPLIED;
    } else if (convertible !== null && (convertible > 0 || base.epochTextRowsConverted > 0)) {
      // The local twin's statement, batched: same SET expression, same WHERE,
      // and since #6009 the same `and not (guard)` exclusion. A row whose only
      // reading is the julian-day limb is left exactly as it is — the promise
      // the contract already makes for every other uninterpretable value.
      const convergeSql =
        `update ${table} set ${col} = ${canonical} where rowid in (` +
        `select rowid from ${table} where ${notCanonicalSql(col, canonical)} ` +
        `and not ${guard} limit ?)`;
      const phase = await runBatchedUpdate(client, convergeSql, batchSize, maxBatches);
      base.rowsConverted = phase.rowsConverted;
      base.budgetExhausted ||= phase.budgetExhausted;
    }

    const after = readProbe(await client.execute(buildProbeSql(column, rules)), guard !== null);
    base.residualRows = after.residual;
    base.pendingEpochTextRows = after.epochInBand;
    // Everything digits-only that is left and is NOT still convertible. Read the
    // field's own contract before reasoning from this number: it overlaps
    // `nonTemporalTextRowsWithheld` and is NOT uniformly harmless to the mark.
    base.unresolvedEpochTextRows = Math.max(0, after.epochText - after.epochInBand);
    // [#6009] What the guard declined to write, reported rather than buried.
    base.nonTemporalTextRowsWithheld = after.nonTemporalText;
    // The ONLY thing that earns the mark: nothing is left for either phase to
    // change. `residual` alone would not do — an un-converted TEXT epoch is a
    // fixpoint of the shared repair and measures zero there, so a budget-stopped
    // run would look complete and strand its remaining rows forever.
    //
    // ⭐ This same line is ALSO what blocks the mark for a withheld julian row,
    // and it is the half that keeps query answers identical (#6009). Such a row
    // is not a fixpoint of the repair, so it stays counted in `after.residual` —
    // deliberately NOT netted out by `convertibleResidual`, which speaks only
    // for what the `UPDATE` does. The column stays unmarked, the reads keep
    // their repair, and nothing a query matched before this ran has moved.
    base.canonical = after.residual === 0 && after.epochInBand === 0;
    return base;
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Converge every given column, probing them all in one round-trip first.
 *
 * Never throws: a column whose statements fail comes back with `error` set and
 * `canonical: false`, which the caller reads as "leave the read-side repair
 * alone". A migration must never be able to take a boot down (D-B3).
 */
export async function backfillRemoteCanonicalColumns(
  client: RemoteBackfillClient,
  columns: RemoteBackfillColumn[],
  sql: RemoteBackfillSql,
  options: RemoteCanonicalBackfillOptions = {},
  logger?: RemoteBackfillLogger,
): Promise<RemoteCanonicalBackfillReport> {
  if (columns.length === 0) return { columns: [] };

  const probes = await probeRemoteCanonicalColumns(client, columns, sql);
  const reports: RemoteBackfillColumnReport[] = [];

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const probe = probes[i];
    if (probe && 'error' in probe) {
      reports.push({
        ...column,
        epochTextRowsConverted: 0,
        rowsConverted: 0,
        residualRows: 0,
        pendingEpochTextRows: 0,
        unresolvedEpochTextRows: 0,
        nonTemporalTextRowsWithheld: null,
        canonical: false,
        budgetExhausted: false,
        error: probe.error,
      });
      continue;
    }
    const report = await backfillRemoteCanonicalColumn(client, column, sql, options, probe);
    reports.push(report);

    const where = `${column.table}.${column.field}`;
    if (report.error) {
      logger?.warn(
        `[driver-turso] could not canonicalise remote ${column.kind} storage for ${where}; ` +
        `queries stay correct via the read-side repair`,
        { error: report.error },
      );
    } else if (report.rowsConverted || report.epochTextRowsConverted) {
      logger?.info?.(
        `[driver-turso] canonicalised remote ${column.kind} storage (#5770) for ${where}`,
        {
          rowsConverted: report.rowsConverted,
          epochTextRowsConverted: report.epochTextRowsConverted,
          canonical: report.canonical,
        },
      );
    }
    if (report.budgetExhausted) {
      logger?.warn(
        `[driver-turso] remote ${column.kind} backfill for ${where} stopped on its batch ` +
        `budget; the column stays un-marked and resumes on the next run`,
        {
          rowsConverted: report.rowsConverted,
          epochTextRowsConverted: report.epochTextRowsConverted,
          residualRows: report.residualRows,
          pendingEpochTextRows: report.pendingEpochTextRows,
        },
      );
    }
    if (report.unresolvedEpochTextRows > 0) {
      logger?.warn(
        `[driver-turso] ${report.unresolvedEpochTextRows} row(s) in ${where} hold digits-only ` +
        `text outside the interpretable epoch-millisecond band and were left untouched ` +
        `(cloud#1005 后果 B, unresolvable remainder)`,
        { table: column.table, field: column.field },
      );
    }
    if ((report.nonTemporalTextRowsWithheld ?? 0) > 0) {
      // #6009 — the tracker id stays in this comment, never in the string: an
      // operator reading the log has no way to resolve one.
      logger?.warn(
        `[driver-turso] left ${report.nonTemporalTextRowsWithheld} row(s) of ${where} ` +
        `unconverted: their stored value is a bare number, which SQLite's date functions ` +
        `read as a JULIAN DAY, so canonicalising them would overwrite the original bytes ` +
        `with a date nobody wrote. Reads are unchanged — the column keeps its (unindexed) ` +
        `read-side repair until the values are corrected or cleared at the source`,
        { table: column.table, field: column.field, rowsWithheld: report.nonTemporalTextRowsWithheld },
      );
    }
  }

  return { columns: reports };
}

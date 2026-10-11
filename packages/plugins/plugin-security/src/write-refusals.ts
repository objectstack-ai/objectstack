// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Refused catalog writes — the loud half of a seed that landed nothing.
 *
 * The `SeedLogger` sink a seeding pass reports through, the durability line
 * with its mandatory `warn` fallback ({@link logSeedDurabilityFailure}), and
 * the per-pass accumulator that reports refused writes once per object per
 * class ({@link createSeedWriteRefusals}, {@link reportSeedWriteRefusals}).
 */

// The ONE named answer to "is this driver error a unique-constraint
// violation?", and to "which column conflicted". Both are the shipped,
// cross-dialect, measured predicates in `@objectstack/types` — the same pair
// `packages/objectql/src/engine.ts` imports — never a local `23505` /
// `ER_DUP_ENTRY` regex, which is the four-mutually-different-answers defect
// that module was written to retire.
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';

export type SeedLogger = {
  info?: (m: string, meta?: Record<string, any>) => void;
  /**
   * The GUARANTEED channel (#9754), and NON-OPTIONAL for that reason.
   *
   * `error` below is optional because hosts legitimately inject reduced
   * sinks — so `warn` is where a durability report degrades to, and a
   * fallback that may itself be absent is not a fallback. With both optional,
   * `{}` satisfied this type and every value of it was permitted to print
   * NOTHING; the call site cannot repair that, only the type can. Making
   * `error` required instead is the measured-and-rejected option, and a
   * required `info` would not do either: a lost write reported at `info` is
   * the reassuring half-truth the degradation-level rule exists to remove.
   *
   * ⚠️ Call sites still spell it `logger?.warn?.(…)`. That `?.` is the
   * backstop for hosts the TYPE cannot reach (a plain-JS embedder, or a
   * cast), not doubt about this declaration.
   */
  warn: (m: string, meta?: Record<string, any>) => void;
  /**
   * Durability-degradation channel (AGENTS.md "Degradation log levels").
   * A catalog write that was supposed to land and did not is an `error`, not a
   * `warn`: nothing looks broken afterwards, which is exactly why it has to be
   * loud. {@link reportSeedWriteRefusals} routes only the unique-violation
   * class here — see its doc for why the other class stays functional.
   *
   * OPTIONAL, deliberately: hosts do inject reduced sinks, and forcing this
   * member would foreclose them (the measured-and-rejected option in the
   * sibling `ProjectionLogger`). The fallback to `warn` is therefore
   * mandatory at every call site, and lives in
   * {@link logSeedDurabilityFailure} so no site can forget it.
   *
   * Signature matches `ProjectionLogger.error` in this package and
   * `Logger.error` in `@objectstack/spec/contracts` — the CAUSE is its own
   * second argument, meta is third — so the kernel logger satisfies this
   * as-is. Getting the arity wrong here would put the meta object in the
   * error slot, where a `Logger` neither reads nor serializes it.
   */
  error?: (m: string, error?: Error, meta?: Record<string, any>) => void;
};

/**
 * Emit one durability-degradation line, falling back to `warn` when the host
 * injected a sink with no `error`.
 *
 * ⛔ NOT `logger?.error?.(...)`. That spelling prints NOTHING against a
 * reduced sink, which would silently drop the loudest line in this module in
 * order to look tidy — the failure the whole rule exists to prevent.
 *
 * ⛔ NOT `(logger.error ?? logger.warn)(...)` either. That evaluates to a bare
 * FUNCTION and calls it with `this === undefined`; `@objectstack/core`'s
 * `ObjectLogger` is a class whose `error` reaches for `this.writeErrorLike`,
 * so a detached call throws. Plain-closure sinks — every double in this
 * package — survive it perfectly, which is why no suite would catch it.
 * Both prohibitions and this exact `if`/`else` spelling are the measured
 * conclusions recorded on `SqlDriver.logDurabilityFailure`; the property-access
 * call form below keeps the receiver.
 *
 * The `?.` on `warn` is the backstop for hosts the TYPE cannot reach (a
 * plain-JS embedder, or a cast), not doubt about the declaration.
 *
 * EXPORTED rather than module-private, for the reason its own doc gives — the
 * fallback "lives in {@link logSeedDurabilityFailure} so no site can forget
 * it". Two sites outside the catalog seed now report a refused write and owe
 * the identical fallback: `permission-set-drift.ts` (a refused drift-diagnostic
 * write) and `permission-set-overlay-discard.ts` (a refused resync after a
 * sanctioned overlay discard). They reuse this spelling and NOT
 * {@link reportSeedWriteRefusals}, whose PROSE is catalog-seed-specific — see
 * the deviation note in each of those call sites. Deliberately absent from the
 * package's `index.ts`: this is an intra-package helper, not public API.
 */
export function logSeedDurabilityFailure(
  logger: SeedLogger | undefined,
  message: string,
  meta?: Record<string, any>,
): void {
  // No single cause: this line summarises N refusals, so the cause slot is
  // `undefined` and the detail travels in meta — the same shape the sibling
  // reconcile summary in `permission-set-projection.ts` uses.
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn?.(message, meta);
}

/**
 * Why a catalog write was refused, as far as a seeder can honestly tell.
 *
 * Two classes, kept apart on purpose. A `unique-violation` is a DEPLOYMENT
 * SCHEMA defect with a migrate remedy; anything else is not, and that remedy
 * does not apply to it. Folding the second into the first would send an
 * operator to `os migrate` for a failure no migration can touch — the same
 * "a confident wrong answer is worse than no answer" reasoning
 * `uniqueViolationColumn` is built on — so `other` is reported as its own line
 * and never silently relabelled.
 */
export type SeedWriteRefusalClass = 'unique-violation' | 'other';

/** One aggregated line's worth of refusals: one object, one class, one pass. */
export interface SeedWriteRefusalReport {
  object: string;
  class: SeedWriteRefusalClass;
  /** How many writes this pass had refused for this object and class. */
  count: number;
  /**
   * The driver's own `code`/`errno` values, de-duplicated and sorted.
   * Machine constants only — see {@link createSeedWriteRefusals}.
   */
  driverCodes: string[];
  /**
   * The conflicting COLUMN, when the dialect determinably named one. Usually
   * empty: most dialects name an index instead, and the shipped extractor
   * answers `undefined` there rather than reading a column out of an index
   * name (maintainer ruling, 2026-08-08).
   */
  columns: string[];
}

/**
 * The refusals ONE seeding pass accumulated, so the pass can report them once.
 *
 * Aggregate-then-warn, for the same reason {@link warnOrganizationLessRows}
 * aggregates: the catalog seeds every declared position, permission set and
 * capability for every organization, and the failure this exists to surface
 * refuses ALL of them. A line per refused row would print hundreds of entries
 * into the boot log and bury the one sentence naming the remedy. One
 * actionable line per object per class per pass.
 */
export interface SeedWriteRefusals {
  /**
   * Record one refused write.
   *
   * Never throws. A reporter that can fail is a reporter that turns a degraded
   * seed into a broken boot, which is precisely the behaviour change this
   * repair does not make.
   */
  record(object: string, error: unknown): void;
  /** How many writes were refused across every object in this pass. */
  readonly total: number;
  /** One entry per (object, class) that actually saw a refusal, object-sorted. */
  report(): SeedWriteRefusalReport[];
}

/**
 * The code channel is read from `code`/`errno` only, bounded down `cause`.
 *
 * Bounded on purpose. `code`/`errno` carry machine constants — `ER_DUP_ENTRY`,
 * `23505`, `SQLITE_CONSTRAINT_UNIQUE` — and never a caller's value, which is
 * what makes them safe to print into a server log. The MESSAGE channel is the
 * one a SQL driver prefixes with the fully bound statement, and nothing here
 * reads it. A "code" longer than this is not a code but something else wearing
 * the field's name, and is dropped rather than printed.
 */
const MAX_DRIVER_CODE_LENGTH = 64;
const MAX_REPORTED_DRIVER_CODES = 4;
const MAX_REPORTED_COLUMNS = 8;
const MAX_CODE_CAUSE_DEPTH = 4;

function collectDriverCodes(error: unknown, into: Set<string>, depth = 0): void {
  if (error === null || error === undefined || typeof error !== 'object') return;
  if (depth > MAX_CODE_CAUSE_DEPTH) return;
  const err = error as { code?: unknown; errno?: unknown; cause?: unknown };
  for (const channel of [err.code, err.errno]) {
    if (typeof channel === 'number' && Number.isFinite(channel)) {
      into.add(String(channel));
    } else if (
      typeof channel === 'string' &&
      channel !== '' &&
      channel.length <= MAX_DRIVER_CODE_LENGTH
    ) {
      into.add(channel);
    }
  }
  collectDriverCodes(err.cause, into, depth + 1);
}

interface RefusalBucket {
  count: number;
  codes: Set<string>;
  columns: Set<string>;
}

/** Start a fresh refusal log for one seeding pass. */
export function createSeedWriteRefusals(): SeedWriteRefusals {
  const byObject = new Map<string, Map<SeedWriteRefusalClass, RefusalBucket>>();
  let total = 0;
  return {
    record(object: string, error: unknown): void {
      // The classification is the SHIPPED predicate's, never a local regex.
      // `isUniqueViolationError` reads `code`, `errno` and an allowlist of
      // measured violation phrasings across the three dialects we ship, and
      // answers `false` for everything it does not recognise — including the
      // absence sentences that contain the very words "unique constraint".
      const klass: SeedWriteRefusalClass = isUniqueViolationError(error)
        ? 'unique-violation'
        : 'other';
      let entry = byObject.get(object);
      if (!entry) {
        entry = new Map();
        byObject.set(object, entry);
      }
      let bucket = entry.get(klass);
      if (!bucket) {
        bucket = { count: 0, codes: new Set(), columns: new Set() };
        entry.set(klass, bucket);
      }
      bucket.count += 1;
      total += 1;
      collectDriverCodes(error, bucket.codes);
      // `undefined` whenever the dialect named an INDEX rather than a column,
      // which is the usual answer for this failure. That is the shipped
      // contract and it is respected here: an absent column is simply not
      // printed, never replaced with a guess derived from an index name.
      const column = uniqueViolationColumn(error);
      if (typeof column === 'string' && column !== '') bucket.columns.add(column);
    },
    get total() {
      return total;
    },
    report(): SeedWriteRefusalReport[] {
      const out: SeedWriteRefusalReport[] = [];
      const objects = [...byObject.keys()].sort();
      for (const object of objects) {
        for (const klass of ['unique-violation', 'other'] as const) {
          const bucket = byObject.get(object)?.get(klass);
          if (!bucket || bucket.count === 0) continue;
          out.push({
            object,
            class: klass,
            count: bucket.count,
            driverCodes: [...bucket.codes].sort().slice(0, MAX_REPORTED_DRIVER_CODES),
            columns: [...bucket.columns].sort().slice(0, MAX_REPORTED_COLUMNS),
          });
        }
      }
      return out;
    },
  };
}

/**
 * Report a pass's refused catalog writes — once per object per class.
 *
 * ## The failure this closes
 *
 * The catalog seeders answer a refused write with `null`/`false`, which is
 * indistinguishable from "nothing to do": the `seeded` counter simply never
 * increments and the pass returns normally. On a deployment still enforcing a
 * PLATFORM-WIDE unique index on the name column from before per-organization
 * materialization, EVERY per-organization insert is refused that way, and the
 * boot log reads as a successful seed of zero rows — which is how a deployed
 * plane ran for weeks with an empty catalog and a clean log.
 *
 * The outer handler on the organization-creation hook does not catch this and
 * structurally cannot: the refusal is converted to `null` three call layers
 * below it, so its `await` resolves normally and it logs "RBAC catalog seeded"
 * at `info` over a seed of nothing. Another outer `try`/`catch` would change
 * nothing. The signal has to survive the inner helper — which is what
 * {@link SeedWriteRefusals} carries and what this function prints.
 *
 * ## Why it LOGS and does not throw
 *
 * A rethrow would convert a silent degradation into a boot failure on every
 * deployment carrying the legacy index — a far larger behaviour change than
 * the diagnosis this repair delivers, and one that decides whether a
 * deployment boots at all. Loud is the ask; fatal is not. The pass still
 * returns its counts, still creates every row the database accepts, and is
 * still retried on the next boot and on organization creation.
 *
 * ## The two classes take DIFFERENT levels, and the split is the rule's own
 *
 * AGENTS.md "Degradation log levels" decides this with one question — *after
 * the degradation, does the system still look normal from the outside while
 * something it claims is persisted has not actually landed?*
 *
 * - **`unique-violation` -> `error`.** Yes, exactly. The boot goes on to log
 *   "RBAC catalog seeded" at `info` over zero landed rows; nothing looks
 *   broken; the loss surfaces later to somebody who cannot connect it back to
 *   this boot. That is the #4420 accident on a different table — the durable
 *   suspended-run store was attached to a table that was never created, every
 *   write failed into a `warn` nobody read, and each restart silently dropped
 *   every in-flight approval while the system reported itself healthy the
 *   whole time. Per the rule, such a line owes both halves in its first
 *   sentence: the CONSEQUENCE (the catalog did not land, and the deployment
 *   will keep looking healthy) and the FIX (the migrate remedy).
 * - **`other` -> `warn`.** No. A refusal that is not a unique violation is
 *   typically a plain outage — an unreachable database, a transient fault —
 *   which retries on the next boot and on organization creation, and which
 *   the next person to open Setup discovers. Escalating it would be the
 *   over-application the same section warns about: it is what trains everyone
 *   to skim `error`, and that skimming is what made #4420's `warn` unreadable
 *   in the first place.
 *
 * ⚠️ `check:durability-log-level` does NOT vouch for either choice. That gate
 * is deliberately narrow: it judges a `catch` whose `try` calls an operation
 * in its declared `DURABILITY_CRITICAL_CALLEES` vocabulary, and `ql.insert` is
 * not in it. Its green over this file means the site is OUTSIDE the gate's
 * reach — NOT MEASURED — never that the level was approved.
 *
 * ## Where the colliding index is named — and why not here
 *
 * The identifier the driver printed (`for key '...'` on MySQL,
 * `violates unique constraint "..."` on PostgreSQL,
 * `UNIQUE constraint failed: index '...'` on SQLite) lives in the error
 * MESSAGE, which a SQL driver builds by prefixing the fully bound statement —
 * every value inlined — to the database's diagnostic. Printing that from here
 * would re-open the server-log exposure `redactBoundStatement` exists to
 * close. It does not need reprinting: the query engine already logs every one
 * of these refusals at ERROR with that redaction applied, and the redaction
 * deliberately KEEPS the identifier-bearing tail so that an operator debugging
 * a duplicate can read the index name. So this line points at those entries
 * instead of re-deriving them, and prints only the value-free code channel
 * plus a column on the rare dialect that determinably names one.
 */
export function reportSeedWriteRefusals(
  logger: SeedLogger | undefined,
  refusals: SeedWriteRefusals,
  organizationId?: string,
): void {
  const entries = refusals.report();
  if (entries.length === 0) return;
  const scope = organizationId ? { organization: organizationId } : { posture: 'single' };

  for (const entry of entries) {
    const meta = {
      object: entry.object,
      ...scope,
      refused: entry.count,
      class: entry.class,
      ...(entry.driverCodes.length > 0 ? { driverCodes: entry.driverCodes } : {}),
      ...(entry.columns.length > 0 ? { columns: entry.columns } : {}),
    };

    if (entry.class === 'unique-violation') {
      // Durability channel, with the mandatory `warn` fallback — see
      // `logSeedDurabilityFailure`.
      logSeedDurabilityFailure(
        logger,
        `[security] ${entry.count} ${entry.object} row(s) were REFUSED BY A UNIQUE CONSTRAINT ` +
          `while seeding the RBAC catalog — the catalog is INCOMPLETE, this pass's "seeded" count ` +
          `is a count of the rows that LANDED rather than of the rows that were declared, and ` +
          `THE DEPLOYMENT WILL GO ON LOOKING HEALTHY: the boot reports a completed seed and ` +
          `nothing else fails, so this line is the only notice that the catalog did not land. ` +
          `It is a DEPLOYMENT SCHEMA defect rather than a data one: the catalog upserts by ` +
          `(name, organization_id), so a refusal means the database still enforces a ` +
          `PLATFORM-WIDE unique index on the name column from before per-organization ` +
          `materialization. Under that index the first organization takes every catalog name and ` +
          `every organization after it is refused, which presents as an empty Setup — no ` +
          `positions, no permission sets, no capabilities — under a clean boot log. The COLLIDING ` +
          `INDEX is named in the query engine's "Insert operation failed" / "Update operation ` +
          `failed" entries logged just before this one: those keep the driver's own identifier ` +
          `(MySQL's "for key", PostgreSQL's "violates unique constraint") with the bound ` +
          `statement and its values cut. Remedy: run "os migrate plan", where the legacy index is ` +
          `reported as a replace_unique_index operation that swaps it for the per-organization ` +
          `composite, then "os migrate apply". Until that is applied every boot re-attempts and ` +
          `re-refuses these rows — nothing is lost, and nothing arrives either.`,
        meta,
      );
      continue;
    }

    logger?.warn?.(
      `[security] ${entry.count} ${entry.object} row(s) were REFUSED while seeding the RBAC ` +
        `catalog for a reason that is NOT a unique-constraint violation — the catalog is ` +
        `INCOMPLETE and this pass's "seeded" count under-reports what was declared. Reported as ` +
        `its own class on purpose: this is NOT the legacy platform-wide-index defect, and the ` +
        `"os migrate" remedy for that one does not apply here. What the database actually said is ` +
        `in the query engine's "Insert operation failed" / "Update operation failed" entries ` +
        `logged just before this one, with the bound statement and its values cut. Seeding is ` +
        `re-attempted on the next boot and on organization creation.`,
      meta,
    );
  }
}
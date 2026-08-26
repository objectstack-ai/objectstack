// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * seed-tenancy-backfill — heal an install whose seed rows and API rows disagree
 * about tenancy, and whose autonumber counters therefore disagree about scope
 * (#8686).
 *
 * ## The defect this repairs
 *
 * Two write paths disagreed about who stamps `organization_id`:
 *
 *   - the SEED loader resolves the install's organization at seed time, and a
 *     FIRST boot has none yet (the admin signs up after the server is up), so
 *     `resolveSoleOrganizationId` correctly returns `undefined` and business
 *     seed rows land `organization_id = NULL`;
 *   - the API path writes with the signed-in user's organization.
 *
 * The SQL driver keys its counter by exactly that column
 * (`resolvedTenantId = tenantField && tenantId ? tenantId : GLOBAL_TENANT`), so
 * one object ends up with TWO `_objectstack_sequences` rows:
 *
 *     object=crm_case  tenant_id='__global__'            last_value=38   <- seed
 *     object=crm_case  tenant_id='org_mssymr19xzd645gv'  last_value=4    <- API
 *
 * and the uniqueness index is partitioned by the same column
 * (`COALESCE(organization_id, '__global__'), case_number`, ADR-0120 D3), so the
 * two partitions can hold the same business identifier without the constraint
 * ever firing. Measured on 17.0.0 GA: a fresh single-tenant install seeded with
 * `CASE-00001..38` minted `CASE-00001..4` again on its first four API creates —
 * four duplicated values on a field declared `unique`, zero 409s, no warning.
 *
 * ⛔ This is NOT a counter bug, and must never be "fixed" by making the
 * allocator smarter. Each counter is already CORRECT within its own scope: the
 * org-scoped counter scans its own partition, correctly finds it empty on a
 * fresh database, and correctly starts at 1. The defect is upstream of the
 * counter, in who stamps `organization_id` on a seeded row — which is why the
 * remedy here moves ROWS between partitions and then reconciles the counters to
 * match, rather than touching allocation logic. (#6249's complete-keyset scan
 * was the counter-side remedy, and the card demonstrates it cannot help.)
 *
 * ## What this module does, per the 2026-08-15 maintainer ruling
 *
 * Contract **Option 1** — seed writes carry the organization exactly the way API
 * writes do — so the repair moves the untenanted seed rows INTO the install's
 * organization, collapsing the `__global__` pseudo-tenant back out of peerage
 * with a real organization.
 *
 * Stored data **shape 2** — a one-shot backfill, guarded to single-tenant
 * installs, which stamps the untenanted seed rows and re-syncs the sequence row
 * by merging the `__global__` counter into the org-scoped one at
 * `max(last_value)`.
 *
 * Three sub-rulings that are easy to lose in implementation, all load-bearing:
 *
 *  1. **Single-tenant only.** A multi-tenant install has no derivable answer to
 *     "which organization owns these rows", so the backfill must not guess.
 *  2. **Multi-tenant ⇒ skip, loudly.** Where a split is detected on a
 *     multi-tenant install the backfill SKIPS and names both the condition and
 *     the remedy. Refusing to boot (shape 3) was rejected — it blocks upgrades;
 *     fix-forward-only (shape 1) was rejected — it leaves a known-broken
 *     population minting duplicates.
 *  3. **Already-minted duplicates are REPORTED, never repaired.** Where a seed
 *     row and an API row already share a number, this migration lists them for
 *     the operator and does not renumber either side. Renumbering a business
 *     identifier that has already left the building — on an invoice, in a
 *     notification, in another system's idempotence key — is not a repair.
 *     (Same paradigm as `sys_setting`'s identity-index migration, which hands
 *     back the duplicate list rather than applying a keep-one rule.)
 *
 * ## The receipt (#9451, maintainer ruling 2026-08-20)
 *
 * An applied run also records itself in the `sys_migration` deployment ledger.
 * A repair that rewrites rows and leaves only a `logger.info` line behind cannot
 * answer "was my data rewritten, and when, and which objects" once that line has
 * scrolled or the container has been replaced — and the healthy path is silent
 * by design, so absence of a message is not evidence either way. See the receipt
 * section further down for the destination, the field reading, and why it is
 * best-effort.
 *
 * ## Dialects (#9381)
 *
 * Every statement here is compiled for the dialect the seam is connected to.
 * That is not decoration: MySQL does not run with `ANSI_QUOTES`, so the ANSI
 * `"identifier"` this module used to emit unconditionally is a STRING LITERAL
 * there and every one of the five statements failed to parse — measured on a
 * live MySQL 8.0.46, where all seven statements returned `ER_PARSE_ERROR`
 * before the fix and all seven run after it. Two MySQL-specific traps beyond the
 * quote character, both measured on the same server:
 *
 *   - `last_value` is RESERVED on MySQL 8.0 (`LAST_VALUE()`), so the COLUMN
 *     names are quoted too, not just the tables — an unqualified `last_value`
 *     is a parse error even when the table is spelled correctly;
 *   - `UPDATE t … (SELECT … FROM t)` is refused outright with
 *     `ER_UPDATE_TABLE_USED` (1093), so the stamp's exclusion sub-SELECTs go
 *     through a derived table (see {@link buildStampSql}).
 *
 * The failure was invisible because a migration must never fail a boot: every
 * call site catches and warns, so the symptom on MySQL was a skipped repair in
 * the log, not an error — declared (the module claims MySQL) ≠ enforced.
 *
 * ## Why `max(last_value)` and not `max(data)`
 *
 * The ruling says `max(last_value)`, and the two differ in the direction that
 * matters: a counter is allowed to sit AHEAD of its data (numbers burned by a
 * rolled-back transaction, rows deleted since). Taking the counter high-water
 * mark can only ever skip numbers; taking the data max could re-issue one that
 * a burned allocation already handed out.
 *
 * ## The handoff writes BEFORE it deletes (#12394)
 *
 * The first implementation of the merge lost the very mark the paragraph above
 * insists on. It ran an `UPDATE` of the organization-scoped counter row and then
 * a `DELETE` of the `__global__` one, as two independent statements — and on a
 * FRESH install, which is the normal shape rather than an edge case, there is no
 * organization-scoped row yet: no API create has happened. The `UPDATE` matched
 * nothing, which is a SUCCESS on every dialect; the `DELETE` ran regardless; and
 * `_objectstack_sequences` was left empty. `SqlDriver.getNextSequenceValue` then
 * re-entered the one-time `MAX(data)` bootstrap its own docstring reserves for
 * first allocation, re-derived the counter from the surviving rows, and handed a
 * business identifier out A SECOND TIME — measured on 17.1.0: `ACC-000009` on
 * two different records, because one number had been burned.
 *
 * So the handoff is now one ordered decision instead of two hopeful statements:
 * write the merged mark (INSERT when the destination row is absent, UPDATE when
 * it is not), READ IT BACK, and only then retire the `__global__` row — per
 * scope, since a scoped format runs one counter row per rendered prefix. See
 * {@link mergeSplitCounter}.
 *
 * ⛔ What this deliberately does NOT do is teach the allocator to notice that it
 * is bootstrapping a second time. Reaching `if (!existing)` is not evidence of
 * lost state: a brand-new tenant, a new day, a new `{field}` group each reach it
 * legitimately, on a mature install, constantly — and a destroyed counter leaves
 * no row behind to tell the two apart. A guard there would fire on the hot path
 * and still not detect this defect. The repair belongs where the state is
 * destroyed, which is here.
 */

import { createHash } from 'node:crypto';
import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import type { IndexMigrationLogger } from './partial-index-probe.js';

/** The driver-private counter table (`SqlDriver.SEQUENCES_TABLE`). */
export const SEQUENCES_TABLE = '_objectstack_sequences';

/**
 * The NULL-organization sentinel, ADR-0120 D3's exact form. Mirrors
 * `GLOBAL_TENANT` in `driver-sql/schema-drift.ts` — re-spelled rather than
 * imported because `metadata-protocol` must not depend on a driver.
 */
export const GLOBAL_TENANT = '__global__';

/** The tenant column every business object carries. */
export const ORGANIZATION_FIELD = 'organization_id';

/** The organization table the single-tenant guard counts. */
export const ORGANIZATION_TABLE = 'sys_organization';

/**
 * Raw-SQL seam that can RETURN ROWS and accept bound parameters.
 *
 * Deliberately not `IndexExec`. That seam is `(sql) => Promise<unknown>` and is
 * fire-and-forget by design — its sibling migrations only ever *print* their
 * probe SQL for the operator and never read it back. This migration has to READ
 * (which objects split, which values collide, how many organizations exist) and
 * has to write values it did not author (an organization id), so it takes
 * parameters instead of interpolating them.
 */
export type SeedTenancyExec = (sql: string, params?: unknown[]) => Promise<unknown>;

/** @see IndexMigrationLogger */
export type SeedTenancyLogger = IndexMigrationLogger;

export type SeedTenancyBackfillStatus =
  /**
   * No raw-SQL-capable driver at all — the engine exposes neither `execute` nor
   * `raw`, so no seam was resolved. A test double with no driver is the case.
   *
   * ⚠️ NOT a memory engine, however plausible that reads (#10789). A memory
   * engine's `execute` is a no-op that RETURNS rather than being absent, so it
   * resolves a seam and reports {@link 'absent'} — this branch never sees it.
   */
  | 'no-driver'
  /**
   * The counter table could not be read: either there is no
   * `_objectstack_sequences` (nothing has ever allocated a number), or the seam
   * answered nothing at all — a memory engine's no-op `execute` (#10789), and
   * the case this branch's comment always claimed. `detail` names which.
   */
  | 'absent'
  /** No object holds both a `__global__` and an organization-scoped counter. */
  | 'no-split'
  /** A split exists but the install is multi-tenant — ruled: skip, loudly. */
  | 'skipped-multi-tenant'
  /**
   * A split exists and the install holds NO organization yet (#12395).
   *
   * Benign, and deliberately NOT folded into `skipped-ambiguous-organization`:
   * with zero organizations there is no second partition, so each object runs
   * exactly one counter and nothing can be minted twice. The state self-heals at
   * the first sign-up through the `sys_organization`-insert handoff.
   *
   * The same 0 / 1 / several line objectql already draws in
   * `resolveSystemWriteOrganization`, whose `no-organization-yet` decision this
   * is named after — "⛔ Refusing here would refuse first boot itself."
   */
  | 'no-organization-yet'
  /** A split exists but the install holds SEVERAL organizations — no derivable owner. */
  | 'skipped-ambiguous-organization'
  /** The backfill ran. */
  | 'applied';

/** One object/field whose counter is split across two partitions. */
export interface SeedTenancySplit {
  object: string;
  field: string;
  globalLastValue: number;
  organizationLastValue: number;
}

/**
 * One business identifier already minted on BOTH sides of the split. Reported,
 * never repaired.
 */
export interface SeedTenancyCollision {
  object: string;
  field: string;
  value: string;
  rows: number;
}

export interface SeedTenancyBackfillResult {
  status: SeedTenancyBackfillStatus;
  /** Every split detected, whether or not it was repaired. */
  splits: SeedTenancySplit[];
  /** Duplicated identifiers found across the split — reported, not renumbered. */
  collisions: SeedTenancyCollision[];
  /**
   * OBJECTS whose untenanted rows were moved into the organization — not a row
   * count. The three dialects report an UPDATE's affected-row count in three
   * incompatible shapes (and `raw` hosts report none at all), so a row number
   * here would be a fabrication on at least one of them. The object list is
   * exact everywhere, and it is what the operator needs to verify the repair.
   */
  objectsStamped: number;
  /** The organization adopted, when one was. */
  organizationId?: string;
  /** Driver error text, when there was one. */
  detail?: string;
}

/**
 * The raw-SQL seam PLUS the dialect it speaks — resolved together, from one
 * driver, on purpose (#9381).
 *
 * Every statement in this module interpolates identifiers, and the three
 * supported dialects do not spell an identifier the same way. An `exec` handed
 * around without the dialect beside it is an invitation to compile ANSI SQL for
 * a server that does not parse it — which is exactly the defect #9381 records:
 * `"x"` is an identifier on SQLite and PostgreSQL, and a STRING LITERAL on
 * MySQL, whose `sql_mode` does not include `ANSI_QUOTES` (measured on MySQL
 * 8.0.46: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,`
 * `ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` — no `ANSI_QUOTES`, and
 * nothing in `driver-sql` sets one; its only session `SET` is `time_zone`).
 *
 * So the two travel as ONE value: a caller cannot obtain the exec without also
 * obtaining the client name, and {@link backfillSeedTenancy} takes the pair
 * rather than a bare function. That is the structural half of the fix — the
 * quoting helper alone would still let a future caller lose the dialect.
 */
export interface SeedTenancySeam {
  /** The row-returning raw-SQL seam. */
  exec: SeedTenancyExec;
  /**
   * The knex client name of the driver behind {@link exec} — `'mysql2'`,
   * `'mysql'`, `'pg'`, `'better-sqlite3'`, `'sqlite3'`. `undefined` on a host
   * that exposes no config, where the ANSI spelling is the only sane default
   * (it is what SQLite and PostgreSQL want, and what a MySQL running with
   * `ANSI_QUOTES` would want too).
   */
  client?: string;
  /**
   * The engine the exec was resolved FROM, narrowed to what the durable receipt
   * needs (#9451). `undefined` on a host that is not an engine — a hand-built
   * seam in a test, a raw-SQL probe — where there is no ledger to write.
   *
   * It travels on the seam for the same reason `client` does: so a caller
   * cannot take the write path without also taking the path that records it.
   * The two are not symmetric, though, and the difference is worth stating —
   * losing `client` compiles SQL for the wrong dialect and fails LOUDLY, while
   * losing this one would only mean the repair goes back to leaving no trace,
   * which is silent and is exactly the defect #9451 exists to remove.
   */
  ledger?: SeedTenancyLedger;
}

/**
 * Resolve a row-returning raw-SQL seam, together with the dialect it speaks.
 *
 * `execute` is probed BEFORE `raw` — the opposite order to
 * `resolveIndexExecForTable` — because `execute(sql, params)` carries bound
 * parameters and `raw(sql)` does not. Every probe is individually guarded so
 * this returns `undefined` rather than throwing into a boot hook.
 *
 * Unlike its sibling this does not ask `getDriverForObject`: the target table is
 * `_objectstack_sequences`, which is driver-private and not a registered object,
 * so there is nothing to ask about. The engine's own default driver is the one
 * that owns it.
 *
 * The client name is read from the SAME driver object the exec came from
 * (`driver.config.client`, the field `SqlDriver.isMysql` itself reads, and the
 * same source `os migrate duplicates` uses for its own probes), so the dialect
 * can never describe a different connection than the one the statements run on.
 */
export function resolveSeedTenancySeam(engine: unknown): SeedTenancySeam | undefined {
  const engineAny = engine as any;
  const attempt = (fn: () => unknown): any => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const canRun = (d: any): boolean =>
    !!d && (typeof d.execute === 'function' || typeof d.raw === 'function');

  let driver: any = attempt(() => engineAny?.driver);
  if (!canRun(driver)) driver = attempt(() => engineAny?.getDefaultDriver?.());
  if (!canRun(driver) && engineAny?.drivers instanceof Map) {
    driver = undefined;
    for (const candidate of engineAny.drivers.values()) {
      if (canRun(candidate)) {
        driver = candidate;
        break;
      }
    }
  }
  if (!canRun(driver)) return undefined;
  const client = resolveClientName(driver);
  // Resolved from the ENGINE, not from the driver the exec came from: the
  // ledger row is written through the object layer (`sys_migration` is a
  // registered object with a kernel-injected tenant column and generated
  // timestamps), never as raw SQL against a table this module would then have
  // to spell for three dialects.
  const ledger = resolveSeedTenancyLedger(engine);
  if (typeof driver.execute === 'function') {
    return {
      exec: (sql: string, params?: unknown[]) => driver.execute(sql, params ?? []),
      client,
      ledger,
    };
  }
  return { exec: (sql: string) => driver.raw(sql), client, ledger };
}

/**
 * The knex client name of a driver, best-effort.
 *
 * `SqlDriver.config` is `protected` in TypeScript and an ordinary property at
 * runtime; this module holds the engine as `unknown` and reads it the same way
 * `os migrate duplicates` does. The knex instance is the fallback for a driver
 * that keeps its config elsewhere. Anything unreadable is `undefined`, which
 * means "quote the ANSI way" — today's behaviour, unchanged.
 */
function resolveClientName(driver: any): string | undefined {
  const read = (fn: () => unknown): string | undefined => {
    try {
      const v = fn();
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    read(() => driver?.config?.client) ??
    read(() => driver?.knex?.client?.config?.client) ??
    read(() => driver?.knex?.context?.client?.config?.client)
  );
}

/**
 * The exec half alone, for callers that resolve the dialect themselves.
 *
 * `os migrate duplicates` is the one: it reads `stack.driver.config.client` for
 * its OWN probes and only borrows this resolver's driver-walk. Anything that
 * compiles statements from THIS module must take {@link resolveSeedTenancySeam}
 * instead, so the dialect cannot be dropped on the way.
 */
export function resolveSeedTenancyExec(engine: unknown): SeedTenancyExec | undefined {
  return resolveSeedTenancySeam(engine)?.exec;
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
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  return [];
}

/**
 * ── The seam that ACCEPTS a query but never ANSWERS one (#10789) ───────────
 *
 * {@link normalizeRows} flattens the three shapes a raw SELECT comes back as.
 * A seam can hand back a FOURTH thing, and it means something else entirely:
 * `null` — "I did not run your query". `InMemoryDriver.execute()` is the
 * measured case (it logs `Raw execution not supported in InMemory driver` and
 * returns `null`); it neither throws nor is absent, so `resolveSeedTenancySeam`'s
 * shape test is satisfied and `no-driver` never fires, while `normalizeRows(null)`
 * is `[]` — which is also what a real driver returns for a SELECT that matched
 * nothing.
 *
 * Every branch of this migration reads "no rows" as "healthy install, nothing to
 * do", so the two collapsed into one answer and the module reported `no-split`
 * — "I looked, there is no split" — over a driver it never queried. Step 1's
 * `absent` branch, whose own comment says *"Absent on a memory engine"*, was
 * unreachable there for exactly this reason.
 *
 * ⭐ **A seam that cannot ANSWER is absent, not empty.** The separation keys on
 * the only thing that distinguishes them: a driver that answers returns a RESULT
 * SET. Nothing here names a driver, so any host with the same no-op shape is
 * covered without an allowlist to maintain — the consumer-side shape #10677 /
 * PR #10788 landed for `os migrate duplicates`, applied to this module's own
 * probes.
 */

/**
 * Is `result` one of the result-set shapes a raw SELECT can come back as?
 *
 * The same three {@link normalizeRows} flattens, asked as a yes/no: a bare row
 * array (better-sqlite3 through knex), `{ rows }` (pg), and the `[rows, fields]`
 * tuple (mysql2). An empty result set in any of those spellings is still a
 * result set, and still `true` — that is what keeps a healthy install's
 * `no-split` intact, and it is the half of this change that stops it being a
 * rename.
 *
 * This cannot lose a split that {@link normalizeRows} would have found: every
 * shape it rejects is one already flattened to `[]`, so the only change is
 * "reported as unreadable" replacing "reported as zero rows".
 *
 * ⛔ NOT exported from the package index. It has no consumer outside this
 * module, and the CLI's `migrate/duplicates.ts` carries its own copy for its own
 * probes (#10677) — unifying the two is a separate decision, exactly as
 * `quoteIdent` records for the same pair.
 */
export function isResultSet(result: unknown): boolean {
  if (Array.isArray(result)) return true;
  if (typeof result === 'object' && result !== null) {
    return Array.isArray((result as { rows?: unknown }).rows);
  }
  return false;
}

/** Why a probe was treated as unreadable — the `detail` an operator reads. */
const SEAM_NO_ANSWER_DETAIL =
  'the raw-SQL seam returned no result set — a seam that cannot answer is not a seam that answered "no rows"';

/**
 * Run one READ probe and flatten it, failing when the seam answered nothing.
 *
 * The throw lands in the `catch` each probe below already has, so this adds no
 * new branch and no new status — a probe that cannot answer takes the same route
 * a probe that THREW has always taken. That equivalence is the point: both mean
 * "this migration could not look", and only one of them used to say so.
 *
 * ⛔ READ probes only. An UPDATE or DELETE does not return a result set on every
 * dialect (better-sqlite3 through knex reports a change count, mysql2 a
 * `ResultSetHeader`), so the write statements in step 6 stay on the bare `exec`.
 * Holding them to "must answer" would break the repair on exactly the installs
 * it exists for.
 */
async function selectRows(
  exec: SeedTenancyExec,
  sql: string,
  params?: unknown[],
): Promise<Record<string, unknown>[]> {
  const result = await exec(sql, params);
  if (!isResultSet(result)) throw new Error(SEAM_NO_ANSWER_DETAIL);
  return normalizeRows(result);
}

/**
 * Reject anything that is not a plain SQL identifier.
 *
 * Object and field names reach this module from `_objectstack_sequences` rows
 * and are interpolated into the probe/UPDATE statements, because a table name
 * cannot be a bound parameter in any of the three dialects. Every VALUE is bound
 * (`?`); only identifiers are interpolated, and only after passing this. The
 * platform's own naming rule is `snake_case` machine names, so a name this
 * rejects is one the platform could not have written.
 */
function isSafeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Quote an identifier for the dialect actually connected (#9381).
 *
 * MySQL does not run with `ANSI_QUOTES`, so `"x"` there is a STRING LITERAL and
 * not an identifier — measured on a live MySQL 8.0.46, where every statement
 * this module builds failed with `ER_PARSE_ERROR` before this fix. One quoting
 * style for every dialect cannot run on all three.
 *
 * The same shape, deliberately, as `quoteIdent` in the CLI's
 * `migrate/duplicates.ts` (#8928), which took this route first for its own
 * probes. Two copies is two copies; unifying them is a separate decision (see
 * the PR discussion on #9381) and NOT a drive-by of this fix.
 */
function quoteIdent(name: string, client?: string): string {
  const c = String(client ?? '').toLowerCase();
  if (c === 'mysql' || c === 'mysql2') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Probe statement: does the counter table exist at all? */
export function buildSequencesPresenceSql(client?: string): string {
  return `SELECT ${quoteIdent('tenant_id', client)} FROM ${quoteIdent(SEQUENCES_TABLE, client)} WHERE 1 = 0`;
}

/**
 * Every `(object, field)` that holds a `__global__` counter — i.e. every object
 * the SEED path allocated numbers for while untenanted.
 *
 * ## Why a LEFT JOIN, and not "both counters present"
 *
 * The obvious probe — objects holding a `__global__` row AND an
 * organization-scoped row — describes an install that has ALREADY minted
 * duplicates, and it is the correct detector for the existing-install half. It
 * is the wrong detector for a FRESH install, and getting this wrong makes the
 * whole repair a no-op exactly where the card's repro runs: right after the
 * first sign-up there is no organization-scoped counter yet (no API create has
 * happened), so an inner join finds nothing, the backfill declines, and the very
 * next API create mints the first duplicate.
 *
 * So the trigger is the `__global__` counter alone, and the organization-scoped
 * `last_value` is optional. That widens the repair from "heal the damage" to
 * "close the split before it can do damage", which is the ruled contract
 * (Option 1) rather than merely its clean-up.
 */
export function buildSplitProbeSql(client?: string): string {
  const t = quoteIdent(SEQUENCES_TABLE, client);
  const q = (name: string) => quoteIdent(name, client);
  // `last_value` is a RESERVED word on MySQL 8.0 (the `LAST_VALUE()` window
  // function), so even the bare column name is an `ER_PARSE_ERROR` there —
  // measured. Every identifier is quoted, not just the table.
  return (
    `SELECT g.${q('object')} AS ${q('object')}, g.${q('field')} AS ${q('field')}, ` +
    `g.${q('last_value')} AS ${q('global_last_value')}, ` +
    `o.${q('last_value')} AS ${q('organization_last_value')} ` +
    `FROM ${t} g LEFT JOIN ${t} o ` +
    `ON g.${q('object')} = o.${q('object')} AND g.${q('field')} = o.${q('field')} ` +
    `AND o.${q('tenant_id')} <> ? ` +
    `WHERE g.${q('tenant_id')} = ?`
  );
}

/**
 * Platform namespaces whose seeds are deliberately global/cross-tenant and must
 * NEVER be adopted into an organization.
 *
 * The exact rule the seed loader applies when it decides whether to stamp its
 * single-organization fallback (`/^(sys_|cloud_|ai_)/` in `seed-loader.ts`). It
 * is re-spelled here rather than shared because the two live in different layers
 * — but it is the same rule, and it has to stay the same rule: this migration
 * exists to make stored rows match what the loader would write today, so a
 * migration that adopted a namespace the loader deliberately leaves global would
 * be manufacturing a NEW disagreement between the two write paths while claiming
 * to remove one.
 */
const PLATFORM_NAMESPACE = /^(sys_|cloud_|ai_)/;

/**
 * What the affected-object list is, and is not (#12395).
 *
 * It is read from `_objectstack_sequences` at the instant this probe runs, and
 * this probe runs on `kernel:ready`. A seed that overruns its budget keeps
 * writing in the BACKGROUND past that point (`[Seeder] Inline seed exceeded
 * <n>ms budget … continuing in background to avoid blocking kernel start`), so a
 * first boot can reach here with only part of the seed's counters allocated —
 * measured at 194 ms apart, naming 3 objects where the settled database holds 9.
 *
 * Stated rather than removed by ordering: the boot pass exists for the
 * EXISTING-install half, whose rows are already written and need no wait, and
 * the fresh-install half is delivered by the `sys_organization`-insert handoff,
 * which by construction runs after sign-up. Making boot block on seed settlement
 * would delay a repair that has nothing to wait for.
 */
const SNAPSHOT_CAVEAT =
  `This list is a snapshot taken when the probe ran, not a census: a boot that reaches ` +
  `'kernel:ready' while an over-budget inline seed is still writing in the background names only ` +
  `the counters allocated so far, so a later run on the same database may name more.`;

/** The organizations the install has, capped — the single-tenant guard reads this. */
export function buildOrganizationProbeSql(client?: string): string {
  return `SELECT ${quoteIdent('id', client)} FROM ${quoteIdent(ORGANIZATION_TABLE, client)}`;
}

/**
 * Identifiers already minted on BOTH sides of the split for one object/field.
 *
 * This is the list the ruling requires be REPORTED rather than repaired, so it
 * is a builder (like `buildSysSettingDuplicateProbeSql`) — the operator is
 * handed the same statement the migration ran, so the report does not depend on
 * trusting this module's own summary.
 */
export function buildCollisionProbeSql(object: string, field: string, client?: string): string {
  if (!isSafeIdentifier(object) || !isSafeIdentifier(field)) {
    throw new Error(`unsafe identifier in collision probe: ${object}.${field}`);
  }
  const t = quoteIdent(object, client);
  const f = quoteIdent(field, client);
  const org = quoteIdent(ORGANIZATION_FIELD, client);
  return (
    `SELECT ${f} AS ${quoteIdent('value', client)}, ` +
    `COUNT(*) AS ${quoteIdent('rows_holding', client)} FROM ${t} ` +
    `WHERE ${f} IN (SELECT ${f} FROM ${t} WHERE ${org} IS NULL) ` +
    `AND ${f} IN (SELECT ${f} FROM ${t} WHERE ${org} IS NOT NULL) ` +
    `GROUP BY ${f} ORDER BY ${f}`
  );
}

/**
 * Move this object's untenanted rows into the install's organization — EXCEPT
 * any row whose identifier is already taken in the target partition.
 *
 * ## Why the exclusion exists (measured, not defensive)
 *
 * The bare `UPDATE … WHERE organization_id IS NULL` is refused outright on
 * exactly the installs this migration exists for. Moving the untenanted rows
 * into the organization moves them into the OTHER SIDE of the partitioned unique
 * index, and on an install that has already minted duplicates
 * (`CASE-00001..4` on both sides — the card's own measurement) the destination
 * already holds those values. The statement violates the unique constraint and
 * the driver rolls back ALL of it: measured, a 38-row repair moved zero rows,
 * including the 34 that had no conflict at all, while the counter merge behind it
 * still reported success.
 *
 * Excluding the colliding values is what makes the two halves of the ruling
 * coexist. "Stamp the untenanted seed rows" and "already-minted duplicates are
 * reported, not repaired" are in direct tension on a colliding row — it cannot
 * enter the organization partition unless something renumbers it, and renumbering
 * is precisely what is forbidden. So the movable rows move, the colliding rows
 * stay exactly as they are, and they are named in the collision report.
 *
 * `fields` is every split field of this object: a row is unmovable if it
 * collides on ANY of them.
 *
 * ## Why each guard sub-SELECT is wrapped in a derived table (#9381)
 *
 * MySQL refuses `UPDATE t … WHERE c NOT IN (SELECT … FROM t)` outright:
 * `ER_UPDATE_TABLE_USED` (1093) — "You can't specify target table 't' for update
 * in FROM clause". Measured on a live MySQL 8.0.46, and it is NOT a quoting
 * problem: the statement stays refused after the identifiers are spelled the
 * MySQL way. Selecting the same rows through a derived table makes MySQL
 * materialize them first, which is exactly what the restriction asks for, and
 * the form is plain ANSI — SQLite and PostgreSQL run it unchanged (both
 * measured). The alias is per-field so a multi-autonumber object does not
 * declare the same derived table twice in one statement.
 */
export function buildStampSql(object: string, fields: string[], client?: string): string {
  if (!isSafeIdentifier(object)) {
    throw new Error(`unsafe identifier in stamp: ${object}`);
  }
  const t = quoteIdent(object, client);
  const org = quoteIdent(ORGANIZATION_FIELD, client);
  const guards = fields.map((field, i) => {
    if (!isSafeIdentifier(field)) {
      throw new Error(`unsafe identifier in stamp: ${object}.${field}`);
    }
    const f = quoteIdent(field, client);
    // The derived table's own column and alias are this module's literals, not
    // data — but they are quoted like everything else so one rule covers the
    // whole statement.
    const taken = quoteIdent(`taken_${i}`, client);
    const v = quoteIdent('v', client);
    return (
      ` AND ${f} NOT IN (SELECT ${taken}.${v} FROM ` +
      `(SELECT ${f} AS ${v} FROM ${t} WHERE ${org} IS NOT NULL AND ${f} IS NOT NULL) AS ${taken})`
    );
  });
  return `UPDATE ${t} SET ${org} = ? WHERE ${org} IS NULL${guards.join('')}`;
}

/** Raise the organization-scoped counter to the merged high-water mark. */
export function buildCounterMergeSql(client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  // `last_value` unqualified is an `ER_PARSE_ERROR` on MySQL 8.0 — it is the
  // reserved `LAST_VALUE()` window function there — so the columns are quoted
  // and not only the table (measured).
  return (
    `UPDATE ${q(SEQUENCES_TABLE)} SET ${q('last_value')} = ?, ` +
    `${q('updated_at')} = CURRENT_TIMESTAMP ` +
    `WHERE ${q('object')} = ? AND ${q('field')} = ? AND ${q('tenant_id')} = ?`
  );
}

/** Retire the `__global__` counter once its value has been merged. */
export function buildGlobalCounterDeleteSql(client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  return (
    `DELETE FROM ${q(SEQUENCES_TABLE)} ` +
    `WHERE ${q('object')} = ? AND ${q('field')} = ? AND ${q('tenant_id')} = ?`
  );
}

/**
 * SHA-256 of the composite counter key — the `_objectstack_sequences` primary
 * key, exactly as `SqlDriver.sequenceKeyHash` computes it (#12394).
 *
 * Re-spelled here rather than imported, for the same reason {@link GLOBAL_TENANT}
 * is: `metadata-protocol` must not depend on a driver. The duplication is real,
 * and it is the reason this module used to DELETE the `__global__` row rather
 * than move it — "a hash spelled two ways is a counter the driver cannot find".
 * That objection was right about the hazard and wrong about the remedy: deleting
 * the row hands the merged high-water mark to nobody, and the driver's one-time
 * `MAX(data)` bootstrap then re-derives a number it has ALREADY handed out.
 *
 * So the duplication is kept and CONTROLLED instead. `packages/runtime`'s
 * `seed-tenancy-autonumber-split.integration.test.ts` drives the real
 * `SeedLoaderService`, a real `ObjectQL` and a real `SqlDriver` across a BURNED
 * number, on a fixed-prefix and on a `{field}`-scoped format: a hash disagreeing
 * with the driver's by one byte leaves a row the driver never reads, the driver
 * re-enters its bootstrap, and the burned number is re-issued — which is exactly
 * what those two cases assert does not happen. Divergence is a red test, not a
 * silent counter.
 *
 * The separator is the ASCII unit separator, spelled as the escape \u001f and never as a raw control byte — the driver spells it the same way.
 */
export function sequenceKeyHash(
  object: string,
  tenantId: string,
  field: string,
  scope: string,
): string {
  return createHash('sha256')
    .update(`${object}\u001f${tenantId}\u001f${field}\u001f${scope}`)
    .digest('hex');
}

/**
 * Does the counter table carry the current `key_hash` primary key?
 *
 * The one question that decides how a counter row is KEYED — and therefore how a
 * missing organization-scoped row has to be created. The driver answers it for
 * itself with an in-process flag (`SqlDriver.sequencesHasKeyHash`) this module
 * cannot see, so it is asked of the DATABASE, in the same `WHERE 1 = 0` idiom
 * {@link buildSequencesPresenceSql} already uses: a table without the column
 * refuses the statement, and the refusal IS the answer.
 *
 * `key_hash` implies `scope` — `createSequencesTable` has only ever created the
 * two together — so one probe settles both. A table without it is one whose
 * `ensureSequencesKeyHashShape` rebuild has not run or did not succeed; the
 * driver keys those by `(object, tenant_id, field)` and refuses per-scope
 * formats outright. Matching that here is not a fallback dialect — it is the
 * same key the driver itself uses against the same table.
 */
export function buildSequencesKeyShapeProbeSql(client?: string): string {
  return `SELECT ${quoteIdent('key_hash', client)} FROM ${quoteIdent(SEQUENCES_TABLE, client)} WHERE 1 = 0`;
}

/**
 * The `__global__` counter rows for one split object/field — one per scope.
 *
 * The sibling of {@link buildCounterRowProbeSql}, and the row this migration
 * actually has to MOVE. It reads the STORED `key_hash` rather than recomputing
 * it, so each row is retired by its own identity: a scope this module spelled
 * wrong can then never delete a row it did not just merge.
 */
export function buildGlobalCounterProbeSql(hasKeyHash: boolean, client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  const columns = hasKeyHash
    ? `${q('key_hash')}, ${q('scope')}, ${q('last_value')}`
    : q('last_value');
  return (
    `SELECT ${columns} FROM ${q(SEQUENCES_TABLE)} ` +
    `WHERE ${q('object')} = ? AND ${q('field')} = ? AND ${q('tenant_id')} = ?`
  );
}

/**
 * Read ONE counter row by the key the driver uses on this table shape.
 *
 * Called twice per scope, for two different jobs: to decide INSERT vs UPDATE,
 * and — after the write — to VERIFY that the merged mark actually landed, before
 * anything is deleted. The second read is the guard the original handoff never
 * had: an `UPDATE` matching no row is a SUCCESS on every dialect, so "the
 * statement did not throw" was never evidence that the mark had been written.
 */
export function buildCounterRowProbeSql(hasKeyHash: boolean, client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  const where = hasKeyHash
    ? `${q('key_hash')} = ?`
    : `${q('object')} = ? AND ${q('field')} = ? AND ${q('tenant_id')} = ?`;
  return `SELECT ${q('last_value')} FROM ${q(SEQUENCES_TABLE)} WHERE ${where}`;
}

/** Raise an EXISTING organization-scoped counter row, addressed by `key_hash`. */
export function buildCounterMergeByKeyHashSql(client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  // `last_value` unqualified is an `ER_PARSE_ERROR` on MySQL 8.0 — the reserved
  // `LAST_VALUE()` window function there. See {@link buildCounterMergeSql}.
  return (
    `UPDATE ${q(SEQUENCES_TABLE)} SET ${q('last_value')} = ?, ` +
    `${q('updated_at')} = CURRENT_TIMESTAMP WHERE ${q('key_hash')} = ?`
  );
}

/**
 * Create the organization-scoped counter row AT the merged high-water mark.
 *
 * The statement this handoff was missing. On a FRESH install — the normal first
 * boot, not an edge case — there is no organization-scoped row to raise, because
 * no API create has happened yet; the `UPDATE` matched nothing, reported success,
 * and the mark was then deleted with the `__global__` row.
 *
 * `updated_at` is left to the column default rather than named here: it is
 * defaulted in every shape of this table, and naming it would be one more column
 * to be wrong about on a legacy install.
 */
export function buildCounterInsertSql(hasKeyHash: boolean, client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  const columns = hasKeyHash
    ? [q('key_hash'), q('object'), q('tenant_id'), q('field'), q('scope'), q('last_value')]
    : [q('object'), q('tenant_id'), q('field'), q('last_value')];
  return (
    `INSERT INTO ${q(SEQUENCES_TABLE)} (${columns.join(', ')}) ` +
    `VALUES (${columns.map(() => '?').join(', ')})`
  );
}

/**
 * Move one object/field's `__global__` high-water mark INTO the organization,
 * and only then retire the row it came from (#12394).
 *
 * ## The order, and why every step of it is load-bearing
 *
 * The handoff this replaces did two independent things and hoped they added up:
 * it `UPDATE`d the organization-scoped counter row, then `DELETE`d the
 * `__global__` one unconditionally. On a fresh install — the normal shape, right
 * after the first sign-up — there IS no organization-scoped row yet, so the
 * UPDATE matched nothing (a success, on every dialect), the DELETE ran anyway,
 * and the counter table was left EMPTY. The driver then re-entered its one-time
 * `MAX(data)` bootstrap and re-issued an identifier that had already been handed
 * out: measured on 17.1.0, `ACC-000009` minted twice, to two different records.
 *
 * So the three steps are ordered and each is verified:
 *
 *  1. **Write, per scope.** A scoped format (`{YYYYMMDD}`, `{field}`, per-parent)
 *     runs one counter row per rendered prefix, so the mark is moved scope by
 *     scope, keyed the way the driver keys it. `INSERT` when the destination row
 *     is absent, `UPDATE` when it exists — the absent case is the FIRST-BOOT
 *     case, not an edge one.
 *  2. **Read it back.** "The statement did not throw" is not evidence that a row
 *     was written: an `UPDATE` matching zero rows throws nowhere, and that is
 *     precisely the defect above. The destination row is re-read and must hold at
 *     least the merged value.
 *  3. **Then delete** — the `__global__` row, by its own stored `key_hash`, so
 *     the retirement can only ever hit the row whose mark was just merged.
 *
 * A throw at any point leaves this object's `__global__` row in place, which is
 * the state the next boot's split probe detects and retries. Partial progress is
 * safe for the same reason: a scope already merged and retired is simply no
 * longer split.
 *
 * The merge rule itself is unchanged and is the ruling's: the greater of the two
 * COUNTERS, never the data max — a counter is allowed to sit ahead of its rows,
 * and that gap is exactly what must survive the handoff.
 */
async function mergeSplitCounter(
  exec: SeedTenancyExec,
  client: string | undefined,
  hasKeyHash: boolean,
  object: string,
  field: string,
  organizationId: string,
): Promise<void> {
  const globalRows = await selectRows(exec, buildGlobalCounterProbeSql(hasKeyHash, client), [
    object,
    field,
    GLOBAL_TENANT,
  ]);
  for (const globalRow of globalRows) {
    const scope = hasKeyHash && globalRow.scope != null ? String(globalRow.scope) : '';
    const globalValue = toNumber(globalRow.last_value);
    // How the DRIVER addresses the destination row on this table shape.
    const orgKey = hasKeyHash
      ? [sequenceKeyHash(object, organizationId, field, scope)]
      : [object, field, organizationId];

    const probe = buildCounterRowProbeSql(hasKeyHash, client);
    const existing = await selectRows(exec, probe, orgKey);
    const merged = Math.max(globalValue, existing.length > 0 ? toNumber(existing[0].last_value) : 0);

    if (existing.length > 0) {
      await exec(
        hasKeyHash ? buildCounterMergeByKeyHashSql(client) : buildCounterMergeSql(client),
        hasKeyHash ? [merged, ...orgKey] : [merged, object, field, organizationId],
      );
    } else {
      await exec(
        buildCounterInsertSql(hasKeyHash, client),
        hasKeyHash
          ? [orgKey[0], object, organizationId, field, scope, merged]
          : [object, organizationId, field, merged],
      );
    }

    const landed = await selectRows(exec, probe, orgKey);
    const landedValue = landed.length > 0 ? toNumber(landed[0].last_value) : -1;
    if (landedValue < merged) {
      throw new Error(
        `the organization-scoped counter for ${object}.${field}` +
          (scope === '' ? '' : ` (scope ${JSON.stringify(scope)})`) +
          ` reads ${landedValue < 0 ? 'ABSENT' : String(landedValue)} after the merge, expected at ` +
          `least ${merged} — the '${GLOBAL_TENANT}' row is NOT retired`,
      );
    }

    if (hasKeyHash) {
      await exec(buildGlobalCounterDeleteByKeyHashSql(client), [String(globalRow.key_hash)]);
    } else {
      await exec(buildGlobalCounterDeleteSql(client), [object, field, GLOBAL_TENANT]);
    }
  }
}

/** Retire ONE `__global__` counter row, by its own stored `key_hash`. */
export function buildGlobalCounterDeleteByKeyHashSql(client?: string): string {
  const q = (name: string) => quoteIdent(name, client);
  return `DELETE FROM ${q(SEQUENCES_TABLE)} WHERE ${q('key_hash')} = ?`;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ── The durable receipt (#9451, maintainer ruling 2026-08-20: 「A″-2 写进
//    sys_migration(推荐)」) ────────────────────────────────────────────────
//
// Everything above rewrites stored rows and then says so with ONE `logger.info`
// line. Once that line has scrolled — or the container has been replaced — the
// question "was my data rewritten, and when, and which objects" has no answer
// anywhere in the deployment. Worse, the healthy path (`no-split`) is silent by
// design, so absence-of-message is not evidence either: a silent boot and a boot
// that never reached the probe read identically.
//
// The fix is a row in the ledger that already answers exactly this question for
// every other data migration — `sys_migration`, "one row per DATA migration,
// recording whether THIS deployment has run it". Three properties made it the
// ruled destination over the alternatives:
//
//   - it is writable AND readable at `kernel:ready`, the trigger point that
//     covers every EXISTING deployment. (`SettingsService`, the previously
//     ruled destination, is not: it resolves there with no engine bound, so
//     `set()` answers "resolved" while nothing reaches the database — a receipt
//     that reports success and persists nothing is the very defect this card
//     exists to remove. Measured; recorded separately as #10159.)
//   - its API surface is read-only (`apiMethods: ['get', 'list']`), so the
//     receipt cannot be edited back through the shipped routes;
//   - its row contract lives in `@objectstack/spec/system`, which this package
//     already depends on — so the row is written against the CONTRACT and needs
//     no new dependency on `@objectstack/platform-objects` (where the
//     `recordDataMigrationRun` helper lives). That was the explicit shape of
//     the ruling: A″-2, not A″-1.
//
// ⛔ Written on the `applied` branch only. `no-split` stays silent by design —
// a row per healthy boot would be a ledger of non-events, and the card argues
// for the silence rather than against it.

/**
 * Well-known migration id for this repair's ledger row.
 *
 * Deliberately spelled HERE and not in `@objectstack/spec/system` beside
 * `FILE_REFERENCES_MIGRATION_ID` / `VALUE_SHAPES_MIGRATION_ID`. Those two are
 * there because they are read across packages — a consumer gates its behaviour
 * on them, so the id has to be the same string in the writer and in every
 * reader. This one gates nothing: it is a record for an operator, written in
 * one place and read by a human (or a `SELECT`). Publishing it into the shared
 * contract would declare a coordination point that does not exist.
 */
export const SEED_TENANCY_MIGRATION_ID = 'seed-tenancy-backfill';

/**
 * The engine surface the receipt needs, duck-typed — the same shape
 * `MigrationFlagEngine` names in `@objectstack/platform-objects`, restated
 * structurally rather than imported.
 *
 * Restating four method signatures is the price of the ruled route, and it is
 * paid deliberately: importing the helper would add a workspace dependency
 * `metadata-protocol → platform-objects`, which is the option the maintainer
 * declined. The row shape itself is NOT restated — that comes from
 * {@link DataMigrationFlag} in `@objectstack/spec/system`, so the two writers
 * cannot disagree about what a ledger row is.
 */
export interface SeedTenancyLedger {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/**
 * The ledger seam on an engine, or `undefined` where the host is not one.
 *
 * Resolved from the SAME engine handle {@link resolveSeedTenancySeam} already
 * takes, and carried on the seam beside the exec — so a caller cannot obtain
 * the repair's write path without also obtaining its receipt path. That is the
 * structural half: a third call site added later gets the receipt by
 * construction instead of by remembering, and losing it takes a hand-built
 * seam rather than a forgotten argument.
 */
export function resolveSeedTenancyLedger(engine: unknown): SeedTenancyLedger | undefined {
  const candidate = engine as any;
  for (const method of ['getObject', 'find', 'insert', 'update']) {
    if (typeof candidate?.[method] !== 'function') return undefined;
  }
  return candidate as SeedTenancyLedger;
}

/**
 * The ledger row for one applied run — pure, so the reading below is testable
 * without an engine (Prime Directive #2).
 *
 * ## The field reading, stated because the ledger's fields are gate-bearing
 *
 * `verified_at` and `blocking` are what OTHER migration ids are gated on, so a
 * new id owes an explicit reading of both:
 *
 *  - **`verified_at: null`.** The column means "when the self-check last
 *    PASSED", and this repair has no self-check — it stamps rows and merges a
 *    counter, it does not re-scan the store to prove the result. A timestamp
 *    here would be a certificate nothing earned. Null is also the fail-safe
 *    direction: `isDataMigrationFlagVerified` reads it as "not verified", which
 *    is what an unscanned deployment is. What the row DOES assert lives in
 *    `last_run_at` / `applied_at` / `details`.
 *  - **`blocking: 0`, always.** Blocking means "the gate must stay closed", and
 *    this repair gates no consumer — there is no behaviour anywhere waiting on
 *    this id. A non-zero count here would be a signal with no receiver.
 *  - **`advisory`** carries the collision count: identifiers already minted on
 *    both sides of the split are exactly what the column is for — findings that
 *    "need a modelling decision, never block the gate". They are reported and
 *    never renumbered (2026-08-15 ruling), so they need an operator, not a gate.
 *
 * Verified by enumeration rather than assumed: every consumer of this ledger
 * (`ObjectQL.readMigrationFlagVerified`, `recordObservedDeviation`,
 * `retractCreationAttestation`, and `platform-objects`' `readDataMigrationFlag`)
 * reads `where: { id }, limit: 1`. There is no bulk or aggregate read of
 * `sys_migration` anywhere in the repo, so no reading of these fields under a
 * NEW id can reach another id's gate.
 *
 * `deviation_observed_at` / `deviation_detail` are left untouched: they belong
 * to ADR-0104's escape-hatch protocol, which nothing here participates in, and
 * writing a column no path ever reads is the declared-≠-enforced shape.
 */
export function buildSeedTenancyReceipt(
  result: SeedTenancyBackfillResult,
  now: string,
): DataMigrationFlag {
  return {
    id: SEED_TENANCY_MIGRATION_ID,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    advisory: result.collisions.length,
    details: JSON.stringify({
      status: result.status,
      objectsStamped: result.objectsStamped,
      organizationId: result.organizationId,
      // `object.field`, not the whole split rows: the operator needs to know
      // WHICH objects were touched, and the counter values are a snapshot of a
      // state this run has already destroyed.
      splits: result.splits.map((s) => `${s.object}.${s.field}`),
      collisions: result.collisions.map((c) => `${c.object}.${c.field}=${c.value}`),
    }),
  };
}

/**
 * Upsert the receipt row. Throws on failure — the caller is the one place that
 * decides what a failed receipt means, and it must not be decided twice.
 *
 * Named in `DURABILITY_CRITICAL_CALLEES`
 * (`scripts/check-durability-degradation-log-level.mjs`): if this write is lost,
 * the repair still rewrote the rows and every log line still reads clean, while
 * the only durable record that it happened is simply absent — the #4420 shape
 * on this card's own subject.
 */
async function persistSeedTenancyReceiptRow(
  ledger: SeedTenancyLedger,
  flag: DataMigrationFlag,
): Promise<'inserted' | 'updated'> {
  const context = { isSystem: true };
  const rows = await ledger.find(DATA_MIGRATION_FLAG_OBJECT, {
    where: { id: flag.id },
    limit: 1,
    context,
  });
  const row: Record<string, unknown> = { ...flag, updated_at: flag.last_run_at };
  // A re-run overwrites its own row rather than appending: the ledger's grain is
  // one row per migration, and `sys_migration_journal` is where per-RUN history
  // lives. Idempotence makes this rare — after a successful repair the split
  // probe finds nothing and later boots return `no-split` — but a run that could
  // only stamp some objects leaves a split behind, and the next boot's row
  // should describe the LATEST attempt.
  if (rows?.[0]?.id === flag.id) {
    await ledger.update(DATA_MIGRATION_FLAG_OBJECT, row, { context });
    return 'updated';
  }
  await ledger.insert(DATA_MIGRATION_FLAG_OBJECT, { ...row, created_at: flag.last_run_at }, { context });
  return 'inserted';
}

/**
 * Record one applied run in the deployment ledger — best effort, never fatal.
 *
 * `best-effort-never-fails-boot` is a ruling (2026-08-15) and it constrains the
 * shape here: this cannot rethrow, because it runs inside a `kernel:ready` hook
 * and inside the `sys_organization` create handoff, and neither may be broken by
 * bookkeeping. So the failure is paid for at `error` instead — per AGENTS.md's
 * degradation rule, a write that claims to persist and does not, on a system
 * that keeps looking healthy, is the `error` case.
 *
 * ⛔ The loud log is spelled INLINE rather than through `logProblem()` next
 * door, deliberately: `check:durability-log-level` follows same-FILE helpers
 * only, so routing this catch through another module would make the gate read
 * it as a silent swallow — and, worse, `logProblem` degrades to `warn` on a
 * host with no `error` sink, which is the quiet this rule exists to forbid.
 */
export async function recordSeedTenancyReceipt(
  seam: SeedTenancySeam | undefined,
  result: SeedTenancyBackfillResult,
  logger?: SeedTenancyLogger,
): Promise<void> {
  const ledger = seam?.ledger;
  const notRecorded =
    `[metadata-protocol] the seed/API tenancy repair (#8686) ran and rewrote stored rows, but this ` +
    `deployment has NO durable record that it did`;
  if (!ledger) {
    // Functional absence, not a durability failure: this host is not an engine
    // (a raw seam built by hand, a test double), so there is no ledger to miss.
    // `warn` per AGENTS.md — the system is visibly smaller, not silently lying.
    logger?.warn?.(
      `${notRecorded} — no engine was resolved beside the raw-SQL seam, so ${DATA_MIGRATION_FLAG_OBJECT} ` +
        `could not be written. Capture this boot's log before restarting (#9451).`,
    );
    return;
  }
  try {
    if (!ledger.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
      logger?.warn?.(
        `${notRecorded} — ${DATA_MIGRATION_FLAG_OBJECT} is not registered on this kernel, so the ` +
          `deployment ledger does not exist here. Compose PlatformObjectsPlugin (it carries the ledger ` +
          `every served kernel gets) or capture this boot's log before restarting (#9451).`,
      );
      return;
    }
    const flag = buildSeedTenancyReceipt(result, new Date().toISOString());
    const outcome = await persistSeedTenancyReceiptRow(ledger, flag);
    logger?.info?.(
      `[metadata-protocol] seed/API tenancy repair recorded in ${DATA_MIGRATION_FLAG_OBJECT} ` +
        `(id '${SEED_TENANCY_MIGRATION_ID}', ${outcome}) — the run survives this process (#9451).`,
      { id: SEED_TENANCY_MIGRATION_ID, outcome, details: flag.details },
    );
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    const message =
      `${notRecorded}: writing ${DATA_MIGRATION_FLAG_OBJECT} failed (${detail}). The repair itself ` +
      `SUCCEEDED and is not retried — the rows already carry the organization and the '${GLOBAL_TENANT}' ` +
      `counter is already gone, so the next boot finds no split and will not write this receipt either. ` +
      `Nothing else reports it: capture this boot's log NOW, before the container is replaced. Fix: make ` +
      `${DATA_MIGRATION_FLAG_OBJECT} writable on this deployment (it is provisioned by ` +
      `PlatformObjectsPlugin) and verify with ` +
      `SELECT * FROM ${DATA_MIGRATION_FLAG_OBJECT} WHERE id = '${SEED_TENANCY_MIGRATION_ID}' (#9451).`;
    if (logger?.error) logger.error(message, e instanceof Error ? e : new Error(detail));
    else logger?.warn?.(message, { error: detail });
  }
}

/**
 * Repair the seed/API tenancy split (#8686).
 *
 * Best-effort by design — a boot must never fail because a backfill could not
 * run, which is why every branch returns a status instead of throwing. The one
 * thing it will not do is guess: on any install where the target organization is
 * not derivable it reports and leaves the data exactly as it found it.
 *
 * Idempotent: once the rows carry the organization and the `__global__` counter
 * is gone, the split probe finds nothing and a re-run is `no-split`.
 *
 * Takes the SEAM — exec plus dialect — rather than a bare exec (#9381). Every
 * statement below is compiled for `seam.client`, so the pair has to arrive
 * together or the statements would be spelled for a dialect nobody checked.
 * The seam also carries the engine handle the receipt is written through
 * (#9451), for the same structural reason.
 */
export async function backfillSeedTenancy(
  seam: SeedTenancySeam | undefined,
  logger?: SeedTenancyLogger,
): Promise<SeedTenancyBackfillResult> {
  const empty = { splits: [], collisions: [], objectsStamped: 0 };
  if (!seam?.exec) return { status: 'no-driver', ...empty };
  const { exec, client } = seam;

  // 1. Is there a counter table at all? Absent on a memory engine, and on any
  //    install that has never allocated an autonumber.
  //
  //    TWO ways this probe fails to find one, and the second is #10789. The
  //    table can be missing — the driver raises, and the `catch` reports it. Or
  //    the SEAM can be one that accepts the statement and never runs it: a no-op
  //    `execute` that returns `null` neither throws nor is absent, so this
  //    branch was unreachable on a memory engine despite the comment above
  //    saying it was the case it existed for. Both mean "no counter table was
  //    read", which is what `absent` says; `detail` separates the reasons.
  try {
    if (!isResultSet(await exec(buildSequencesPresenceSql(client)))) {
      return { status: 'absent', ...empty, detail: SEAM_NO_ANSWER_DETAIL };
    }
  } catch {
    return { status: 'absent', ...empty };
  }

  // 2. Which objects are split? Probed FIRST so a healthy install — the
  //    overwhelming majority, including every fresh boot before sign-up — pays
  //    one query and emits nothing at all. Every later branch can then log
  //    loudly, because reaching it means a real defect is present.
  let splits: SeedTenancySplit[];
  try {
    const rows = await selectRows(exec, buildSplitProbeSql(client), [GLOBAL_TENANT, GLOBAL_TENANT]);
    splits = rows
      .filter((r) => isSafeIdentifier(r.object) && isSafeIdentifier(r.field))
      // Platform seeds stay global — the loader's own rule, see PLATFORM_NAMESPACE.
      .filter((r) => !PLATFORM_NAMESPACE.test(String(r.object)))
      .map((r) => ({
        object: String(r.object),
        field: String(r.field),
        globalLastValue: toNumber(r.global_last_value),
        organizationLastValue: toNumber(r.organization_last_value),
      }));
  } catch (e) {
    return { status: 'absent', ...empty, detail: (e as Error).message };
  }
  if (splits.length === 0) return { status: 'no-split', ...empty };

  const affected = splits.map((s) => `${s.object}.${s.field}`).join(', ');

  // 3. The single-tenant guard. BOTH signals must agree, and they answer
  //    different questions: the POSTURE is what the deployment asked for (the
  //    same fact the boot banner prints as `Tenancy: single`, read from the one
  //    protocol-level source rather than re-derived — two notions of tenancy is
  //    how this card happened in the first place), while the organization COUNT
  //    is what the data actually holds. A walled posture is the ruled skip.
  if (postureEnforcesWall(resolveTenancyPosture())) {
    logger?.warn?.(
      `[metadata-protocol] seed/API tenancy split detected on a MULTI-ORGANIZATION install — ` +
        `backfill skipped (#8686). Affected: ${affected}. ` +
        `Seed rows carry ${ORGANIZATION_FIELD} = NULL while API rows carry a real organization, so each ` +
        `object runs two autonumber counters and can mint the same "unique" identifier twice — the ` +
        `partitioned unique index (COALESCE(${ORGANIZATION_FIELD}, '${GLOBAL_TENANT}'), <field>) does not ` +
        `bite across the two. This is NOT repaired automatically because a multi-organization install has ` +
        `no derivable answer to which organization owns the untenanted rows. Remedy: decide the owner per ` +
        `object, then UPDATE <object> SET ${ORGANIZATION_FIELD} = '<org id>' WHERE ${ORGANIZATION_FIELD} ` +
        `IS NULL, and merge that object's '${GLOBAL_TENANT}' row in ${SEQUENCES_TABLE} into the ` +
        `organization-scoped row at the greater last_value. ` +
        SNAPSHOT_CAVEAT,
      { splits, posture: resolveTenancyPosture() },
    );
    return { status: 'skipped-multi-tenant', splits, collisions: [], objectsStamped: 0 };
  }

  // 4. How many organizations does the install hold? Three answers, not two:
  //    none yet (benign, 4a), exactly one (derivable — the repair runs), or
  //    several (ambiguous, 4b).
  //
  //    A probe that THREW is tracked separately and must never reach 4a. It
  //    yields the same empty array as a genuine zero, and reading a failure as
  //    "no organizations yet" is a known way to turn an outage into a benign-
  //    looking log line — objectql fixed that exact confusion in
  //    `resolveSystemWriteOrganization`'s probe (#9261). Unknown is not zero.
  let organizationIds: string[] = [];
  let organizationProbeError = '';
  try {
    organizationIds = (await selectRows(exec, buildOrganizationProbeSql(client)))
      .map((r) => (r.id == null ? '' : String(r.id)))
      .filter((id) => id.length > 0);
  } catch (e) {
    organizationProbeError = (e as Error).message || 'unknown error';
    organizationIds = [];
  }
  // 4a. NO organization yet — benign, and NOT the ambiguous case (#12395).
  //
  //     `!== 1` used to fold this together with "several organizations", and the
  //     two are opposite conditions. With several, the owner is genuinely
  //     underdetermined and an operator has to choose. With NONE, there is no
  //     second partition to be split ACROSS: every counter is the one
  //     `__global__` row, so "two autonumber counters" and "can mint the same
  //     identifier twice" — what the loud branch below says — are both false
  //     here, at a moment when they read as an active data-integrity emergency.
  //     (The `organizationLastValue: 0` this state reports is `buildSplitProbeSql`'s
  //     LEFT JOIN finding no second row, not a second counter sitting at zero.)
  //
  //     Nor is it a state anyone can act on: seeds load inline during `start()`,
  //     while the first organization is created by plugin-auth's
  //     `ensureDefaultOrganization` behind an admin permission-set grant, so it
  //     cannot exist until a sign-up POST reaches a running server. The repair is
  //     already scheduled for that exact moment by the `sys_organization`-insert
  //     handoff in runtime's app-plugin.
  //
  //     `info`, not silence. The split is real even though the hazard is not, and
  //     a diagnostic silenced in BOTH directions would be worse than the one it
  //     replaces — this still says what was seen, it just stops claiming harm.
  if (organizationIds.length === 0 && organizationProbeError === '') {
    logger?.info?.(
      `[metadata-protocol] seed/API tenancy split detected on an install with no organization yet — ` +
        `nothing to adopt, and nothing at risk (#8686). Affected: ${affected}. ` +
        `${ORGANIZATION_TABLE} is empty, so each of these objects runs exactly ONE counter (its ` +
        `'${GLOBAL_TENANT}' row) and no "unique" identifier can be minted twice while there is only ` +
        `one partition. No operator action: this self-heals at the first sign-up, when the ` +
        `${ORGANIZATION_TABLE}-insert handoff runs this same repair against a settled database. ` +
        SNAPSHOT_CAVEAT,
      { splits, organizationCount: 0 },
    );
    return { status: 'no-organization-yet', splits, collisions: [], objectsStamped: 0 };
  }

  // 4b. SEVERAL organizations — the genuinely ambiguous case, still loud.
  if (organizationIds.length !== 1) {
    logger?.warn?.(
      `[metadata-protocol] seed/API tenancy split detected but the target organization is not ` +
        `derivable — backfill skipped (#8686). Affected: ${affected}. ` +
        `The install reports tenancy posture 'single' but holds ${organizationIds.length} rows in ` +
        `${ORGANIZATION_TABLE} (exactly 1 is required to adopt one without guessing). Until this is ` +
        `resolved these objects run two autonumber counters and can mint the same "unique" identifier ` +
        `twice. Remedy: as above — stamp the untenanted rows with the owning organization and merge the ` +
        `'${GLOBAL_TENANT}' counter row into the organization-scoped one. ` +
        (organizationProbeError === ''
          ? ''
          : `NOTE: the ${ORGANIZATION_TABLE} probe FAILED (${organizationProbeError}), so the count ` +
            `above is "unknown", not a measured zero — an unreadable probe is reported here rather ` +
            `than through the benign no-organization-yet path (#9261). `) +
        SNAPSHOT_CAVEAT,
      { splits, organizationCount: organizationIds.length, organizationProbeError },
    );
    return { status: 'skipped-ambiguous-organization', splits, collisions: [], objectsStamped: 0 };
  }
  const organizationId = organizationIds[0];

  // 5. Report the duplicates already minted, BEFORE the stamp merges the two
  //    partitions and makes them indistinguishable. Ruled: reported, never
  //    renumbered — a business identifier that has already been handed out is
  //    not the platform's to rewrite.
  const collisions: SeedTenancyCollision[] = [];
  for (const split of splits) {
    try {
      const rows = await selectRows(exec, buildCollisionProbeSql(split.object, split.field, client));
      for (const r of rows) {
        if (r.value == null) continue;
        collisions.push({
          object: split.object,
          field: split.field,
          value: String(r.value),
          rows: toNumber(r.rows_holding),
        });
      }
    } catch (e) {
      logger?.warn?.(
        `[metadata-protocol] could not list already-minted duplicates for ${split.object}.${split.field} ` +
          `(#8686) — the backfill continues; verify manually with: ` +
          `${buildCollisionProbeSql(split.object, split.field, client)}`,
        { error: (e as Error).message },
      );
    }
  }

  // 6. Stamp the rows, then reconcile the counters. In this order: the counter
  //    merge describes the partition the rows now live in, so a stamp that
  //    failed must not be followed by a counter that claims it succeeded.
  let objectsStamped = 0;
  const fieldsByObject = new Map<string, string[]>();
  for (const split of splits) {
    const fields = fieldsByObject.get(split.object) ?? [];
    fields.push(split.field);
    fieldsByObject.set(split.object, fields);
  }
  const stampFailures: string[] = [];
  for (const [object, fields] of fieldsByObject) {
    try {
      await exec(buildStampSql(object, fields, client), [organizationId]);
      objectsStamped += 1;
    } catch (e) {
      stampFailures.push(object);
      logger?.warn?.(
        `[metadata-protocol] seed tenancy backfill could not stamp ${object} (#8686) — its rows keep ` +
          `${ORGANIZATION_FIELD} = NULL and the counter merge below is SKIPPED for it, so the split ` +
          `survives and the next boot retries. Nothing was lost; nothing was repaired for this object.`,
        { error: (e as Error).message },
      );
    }
  }

  // The counter table's key shape, asked ONCE — it is a property of the
  // database, not of a split, and it decides how every write below is addressed.
  // Unreadable for any reason reads as the legacy shape, which is the
  // conservative answer: it is the key the driver falls back to as well.
  let hasKeyHash = false;
  try {
    hasKeyHash = isResultSet(await exec(buildSequencesKeyShapeProbeSql(client)));
  } catch {
    hasKeyHash = false;
  }

  for (const split of splits) {
    // A counter that describes a partition the rows never reached would be a
    // false receipt — the exact shape the stamp-then-merge ordering exists to
    // prevent. Leave this object's counters untouched so the next boot sees the
    // same split and retries the whole repair.
    if (stampFailures.includes(split.object)) continue;
    try {
      // Re-entrant by construction: the `__global__` rows this reads are the
      // ones it retires, so a second pass over a duplicated (object, field) —
      // which the split probe produces whenever an object holds several scopes —
      // finds nothing left to move.
      await mergeSplitCounter(exec, client, hasKeyHash, split.object, split.field, organizationId);
    } catch (e) {
      logger?.warn?.(
        `[metadata-protocol] seed tenancy backfill could not merge the counter for ` +
          `${split.object}.${split.field} (#8686) — the '${GLOBAL_TENANT}' counter is left in ` +
          `place, so the high-water mark is intact and the next boot retries the repair`,
        { error: (e as Error).message },
      );
    }
  }

  if (objectsStamped > 0) {
    logger?.info?.(
      `[metadata-protocol] seed/API tenancy split repaired for ${objectsStamped} object(s) ` +
        `(#8686): untenanted seed rows adopted organization ${organizationId} and the ` +
        `'${GLOBAL_TENANT}' counter was merged into the organization-scoped one` +
        (collisions.length > 0
          ? `. ${collisions.length} row(s) could NOT be adopted because their identifier is already ` +
            `taken in that organization — they keep ${ORGANIZATION_FIELD} = NULL and are listed below`
          : '') +
        `.`,
      { splits, organizationId, collisions: collisions.length, stampFailures },
    );
  }

  if (collisions.length > 0) {
    // `warn`, not `error`: nothing here failed, and nothing is lost — but the
    // install holds duplicate business identifiers that the platform minted and
    // will NOT rewrite, so an operator has to decide what happens to them.
    logger?.warn?.(
      `[metadata-protocol] ${collisions.length} business identifier(s) were already minted TWICE before ` +
        `this repair (#8686) — reported, NOT renumbered. These values each exist on both a seeded row and ` +
        `an API-created row: ` +
        collisions.map((c) => `${c.object}.${c.field}=${c.value} (${c.rows} rows)`).join(', ') +
        `. The platform does not renumber them: a record number that has already appeared on a document, ` +
        `a notification or another system's idempotence key is not safe to rewrite automatically. Decide ` +
        `per record whether to renumber or retire it. Note that now the rows share one partition, the ` +
        `unique index will refuse any FURTHER duplicate.`,
      { collisions },
    );
  }

  const result: SeedTenancyBackfillResult = {
    status: 'applied',
    splits,
    collisions,
    objectsStamped,
    organizationId,
  };
  // The receipt is written for EVERY applied run, including one where every
  // stamp failed (`objectsStamped === 0`). "A run happened here and moved
  // nothing" is an answer to the card's question; the absence of a row is not.
  await recordSeedTenancyReceipt(seam, result, logger);
  return result;
}

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
 * ## Why `max(last_value)` and not `max(data)`
 *
 * The ruling says `max(last_value)`, and the two differ in the direction that
 * matters: a counter is allowed to sit AHEAD of its data (numbers burned by a
 * rolled-back transaction, rows deleted since). Taking the counter high-water
 * mark can only ever skip numbers; taking the data max could re-issue one that
 * a burned allocation already handed out.
 */

import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
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
  /** No raw-SQL-capable driver — a memory engine or a test double. */
  | 'no-driver'
  /** No `_objectstack_sequences` table: nothing has ever allocated a number. */
  | 'absent'
  /** No object holds both a `__global__` and an organization-scoped counter. */
  | 'no-split'
  /** A split exists but the install is multi-tenant — ruled: skip, loudly. */
  | 'skipped-multi-tenant'
  /** A split exists but the organization count is not exactly 1. */
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
 * Resolve a row-returning raw-SQL seam.
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
 */
export function resolveSeedTenancyExec(engine: unknown): SeedTenancyExec | undefined {
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
  if (typeof driver.execute === 'function') {
    return (sql: string, params?: unknown[]) => driver.execute(sql, params ?? []);
  }
  return (sql: string) => driver.raw(sql);
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

/** Quote an identifier for the target dialect. */
function quoteIdent(name: string): string {
  return `"${name}"`;
}

/** Probe statement: does the counter table exist at all? */
export function buildSequencesPresenceSql(): string {
  return `SELECT tenant_id FROM ${quoteIdent(SEQUENCES_TABLE)} WHERE 1 = 0`;
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
export function buildSplitProbeSql(): string {
  const t = quoteIdent(SEQUENCES_TABLE);
  return (
    `SELECT g.object AS object, g.field AS field, ` +
    `g.last_value AS global_last_value, o.last_value AS organization_last_value ` +
    `FROM ${t} g LEFT JOIN ${t} o ` +
    `ON g.object = o.object AND g.field = o.field AND o.tenant_id <> ? ` +
    `WHERE g.tenant_id = ?`
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

/** The organizations the install has, capped — the single-tenant guard reads this. */
export function buildOrganizationProbeSql(): string {
  return `SELECT id FROM ${quoteIdent(ORGANIZATION_TABLE)}`;
}

/**
 * Identifiers already minted on BOTH sides of the split for one object/field.
 *
 * This is the list the ruling requires be REPORTED rather than repaired, so it
 * is a builder (like `buildSysSettingDuplicateProbeSql`) — the operator is
 * handed the same statement the migration ran, so the report does not depend on
 * trusting this module's own summary.
 */
export function buildCollisionProbeSql(object: string, field: string): string {
  if (!isSafeIdentifier(object) || !isSafeIdentifier(field)) {
    throw new Error(`unsafe identifier in collision probe: ${object}.${field}`);
  }
  const t = quoteIdent(object);
  const f = quoteIdent(field);
  const org = quoteIdent(ORGANIZATION_FIELD);
  return (
    `SELECT ${f} AS value, COUNT(*) AS rows_holding FROM ${t} ` +
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
 */
export function buildStampSql(object: string, fields: string[]): string {
  if (!isSafeIdentifier(object)) {
    throw new Error(`unsafe identifier in stamp: ${object}`);
  }
  const t = quoteIdent(object);
  const org = quoteIdent(ORGANIZATION_FIELD);
  const guards = fields.map((field) => {
    if (!isSafeIdentifier(field)) {
      throw new Error(`unsafe identifier in stamp: ${object}.${field}`);
    }
    const f = quoteIdent(field);
    return ` AND ${f} NOT IN (SELECT ${f} FROM ${t} WHERE ${org} IS NOT NULL AND ${f} IS NOT NULL)`;
  });
  return `UPDATE ${t} SET ${org} = ? WHERE ${org} IS NULL${guards.join('')}`;
}

/** Raise the organization-scoped counter to the merged high-water mark. */
export function buildCounterMergeSql(): string {
  return (
    `UPDATE ${quoteIdent(SEQUENCES_TABLE)} SET last_value = ?, updated_at = CURRENT_TIMESTAMP ` +
    `WHERE object = ? AND field = ? AND tenant_id = ?`
  );
}

/** Retire the `__global__` counter once its value has been merged. */
export function buildGlobalCounterDeleteSql(): string {
  return `DELETE FROM ${quoteIdent(SEQUENCES_TABLE)} WHERE object = ? AND field = ? AND tenant_id = ?`;
}

/** The organization-scoped counter rows for one split object/field. */
function buildOrgCounterProbeSql(): string {
  return (
    `SELECT tenant_id, last_value FROM ${quoteIdent(SEQUENCES_TABLE)} ` +
    `WHERE object = ? AND field = ? AND tenant_id <> ?`
  );
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
 */
export async function backfillSeedTenancy(
  exec: SeedTenancyExec | undefined,
  logger?: SeedTenancyLogger,
): Promise<SeedTenancyBackfillResult> {
  const empty = { splits: [], collisions: [], objectsStamped: 0 };
  if (!exec) return { status: 'no-driver', ...empty };

  // 1. Is there a counter table at all? Absent on a memory engine, and on any
  //    install that has never allocated an autonumber.
  try {
    await exec(buildSequencesPresenceSql());
  } catch {
    return { status: 'absent', ...empty };
  }

  // 2. Which objects are split? Probed FIRST so a healthy install — the
  //    overwhelming majority, including every fresh boot before sign-up — pays
  //    one query and emits nothing at all. Every later branch can then log
  //    loudly, because reaching it means a real defect is present.
  let splits: SeedTenancySplit[];
  try {
    const rows = normalizeRows(await exec(buildSplitProbeSql(), [GLOBAL_TENANT, GLOBAL_TENANT]));
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
        `organization-scoped row at the greater last_value.`,
      { splits, posture: resolveTenancyPosture() },
    );
    return { status: 'skipped-multi-tenant', splits, collisions: [], objectsStamped: 0 };
  }

  // 4. Exactly one organization, or there is nothing derivable to adopt.
  let organizationIds: string[] = [];
  try {
    organizationIds = normalizeRows(await exec(buildOrganizationProbeSql()))
      .map((r) => (r.id == null ? '' : String(r.id)))
      .filter((id) => id.length > 0);
  } catch {
    organizationIds = [];
  }
  if (organizationIds.length !== 1) {
    logger?.warn?.(
      `[metadata-protocol] seed/API tenancy split detected but the target organization is not ` +
        `derivable — backfill skipped (#8686). Affected: ${affected}. ` +
        `The install reports tenancy posture 'single' but holds ${organizationIds.length} rows in ` +
        `${ORGANIZATION_TABLE} (exactly 1 is required to adopt one without guessing). Until this is ` +
        `resolved these objects run two autonumber counters and can mint the same "unique" identifier ` +
        `twice. Remedy: as above — stamp the untenanted rows with the owning organization and merge the ` +
        `'${GLOBAL_TENANT}' counter row into the organization-scoped one.`,
      { splits, organizationCount: organizationIds.length },
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
      const rows = normalizeRows(await exec(buildCollisionProbeSql(split.object, split.field)));
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
          `${buildCollisionProbeSql(split.object, split.field)}`,
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
      await exec(buildStampSql(object, fields), [organizationId]);
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

  for (const split of splits) {
    // A counter that describes a partition the rows never reached would be a
    // false receipt — the exact shape the stamp-then-merge ordering exists to
    // prevent. Leave this object's counters untouched so the next boot sees the
    // same split and retries the whole repair.
    if (stampFailures.includes(split.object)) continue;
    try {
      const orgRows = normalizeRows(
        await exec(buildOrgCounterProbeSql(), [split.object, split.field, GLOBAL_TENANT]),
      );
      for (const row of orgRows) {
        const tenantId = row.tenant_id == null ? '' : String(row.tenant_id);
        if (!tenantId) continue;
        // The ruling's merge rule: the greater of the two COUNTERS, never the
        // data max — a counter is allowed to sit ahead of its rows.
        const merged = Math.max(split.globalLastValue, toNumber(row.last_value));
        await exec(buildCounterMergeSql(), [merged, split.object, split.field, tenantId]);
      }
      // Retire the `__global__` counter last.
      //
      // When there was NO organization-scoped counter (the fresh-install case,
      // `orgRows` empty) this delete is the whole reconciliation, and it is
      // deliberately a delete rather than an insert of a replacement row. The
      // driver keys counters by a `key_hash` it computes in app code, so writing
      // a new row from here would mean re-spelling that hash in a second place —
      // and a hash spelled two ways is a counter the driver cannot find.
      //
      // Deleting instead hands the job to the driver's own first-allocation
      // bootstrap, which is already exactly right: `getNextSequenceValue` sees no
      // row, scans `scanMaxNumericTail` SCOPED TO THE RESOLVED TENANT — which, the
      // stamp above having just run, now includes the adopted seed rows — and
      // starts at that max + 1. One tested code path, no duplicated hashing.
      await exec(buildGlobalCounterDeleteSql(), [split.object, split.field, GLOBAL_TENANT]);
    } catch (e) {
      logger?.warn?.(
        `[metadata-protocol] seed tenancy backfill could not merge the counter for ` +
          `${split.object}.${split.field} (#8686)`,
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

  return { status: 'applied', splits, collisions, objectsStamped, organizationId };
}

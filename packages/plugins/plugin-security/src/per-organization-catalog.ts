// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-organization materialization of the RBAC catalog — the shared vocabulary
 * the four declared/built-in seeders compile against.
 *
 * ## Why the catalog is materialized per organization
 *
 * `sys_position`, `sys_permission_set` and `sys_sharing_rule` all declare
 * `organization_id` with no tenancy opt-out, and both spell their name index
 * `{ fields: ['name'], unique: 'organization' }` — unique PER ORGANIZATION, not
 * globally. The seeders nevertheless upserted by bare `name` under a bare
 * `{ isSystem: true }` context, which stores `organization_id` NULL, so one row
 * stood for every tenant.
 *
 * Under a walled posture that row is invalid state. It was measured to be
 * unreadable by anyone: plugin-security's Layer 0 composes a STRICT
 * `organization_id = :tenant` and the middleware ANDs it over the driver's
 * `(organization_id = :tenant OR organization_id IS NULL)`, and the conjunction
 * of the two is the strict equality alone — so on a walled deployment every
 * principal, at every rung, listed ZERO positions, permission sets and sharing
 * rules while the tables held rows.
 *
 * The repair ruled for that measurement does not touch the wall at either
 * layer. It gives each organization its own row: upsert by
 * `(name, organization_id)`, one pass per organization, so the answer to "which
 * organization owns this row" is never NULL and never shared.
 *
 * ## The doctrine this file implements
 *
 * An organization-less row is INVALID STATE under a walled posture — refuse or
 * warn loudly, never treat it as a platform-wide default. The older reading, in
 * which a NULL organization marked a platform row visible to every tenant,
 * survives only as DRIVER-LEVEL COMPATIBILITY BEHAVIOUR: `applyTenantScope`
 * still emits the `OR organization_id IS NULL` arm, and this module depends on
 * that arm being there — it is precisely how a per-organization pass can still
 * SEE a pre-fix organization-less row and therefore say something about it.
 *
 * ## What replaces a reap
 *
 * #8617 reaped its pre-fix organization-less rows. This catalog does not, and
 * the difference is deliberate rather than an omission:
 *
 * - a fresh walled deployment never mints an organization-less catalog row
 *   FROM THESE FOUR SEEDERS once they run per organization, so there is nothing
 *   of theirs to migrate. It does NOT follow that a fresh walled deployment
 *   holds none, and this file used to claim it did (#11532).
 *   `bootstrapPlatformAdmin` is a FIFTH seeder, outside the four converted
 *   here, and it writes one organization-less `sys_permission_set` row per
 *   `defaultPermissionSets` entry on EVERY boot — before any organization
 *   exists (measured on a fresh walled rig: 8 rows, 1.3 s ahead of the first
 *   `sys_organization`). That is the RULED outcome rather than a leak: the
 *   2026-08-20 maintainer ruling on #10103 keeps that platform bucket
 *   "unreaped and loudly warned about under walled posture", and PLATFORM_ADMIN
 *   is derived from an unscoped grant pointing at its `admin_full_access` row
 *   BY ROW ID, so a reap would silently demote every platform admin. The guard
 *   below therefore has to tell the two classes apart;
 * - a `single`-posture deployment is where organization-less rows are the
 *   CORRECT shape, and the carve-out below leaves it byte-for-byte unchanged;
 * - the rows a reap would delete are grant TARGETS — `sys_user_position`,
 *   `sys_position_permission_set` and `sys_user_permission_set` all point at
 *   them by row id — so deleting them revokes standing access with no signal at
 *   the moment of loss. #8617's reap could promise "NO grant changes" precisely
 *   because it never touched a junction table; here the junctions ARE the
 *   grants.
 *
 * So the pass says so instead. {@link warnOrganizationLessRows} names the
 * rows and names the remedy, and — this is the load-bearing half — the pass
 * still CREATES the organization's own copy. The failure shape it exists to
 * prevent is the silent no-op: a tenant-threaded pass sees the pre-fix
 * organization-less row through the driver's compatibility arm, reads the name
 * as already represented, takes the update branch and creates nothing, leaving
 * the deployment exactly as broken as before while reporting success.
 * {@link resolveOwnOrganizationRow} is the one read that distinguishes "this
 * organization has its row" from "somebody's organization-less row is visible
 * here", and every seeder in this catalog routes through it.
 */

import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
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
 * How many organizations one boot-time seeding sweep enumerates.
 *
 * Bounded for the same reason #8617 bounds its own sweep: this runs on
 * `kernel:ready` and each organization costs a bounded number of reads. An
 * organization past the bound is not left unseeded — the organization-creation
 * hook covers every organization minted after this fix, and a redeploy re-runs
 * the sweep — but the bound IS reported rather than silently truncating.
 */
export const SEED_ORGANIZATION_SCAN_LIMIT = 500;

const ORGANIZATION_OBJECT = 'sys_organization';

/**
 * The system context ONE seeding pass runs under.
 *
 * `organizationId` present ⇒ a tenant-scoped pass: reads route through
 * `SqlDriver.applyTenantScope` and writes are stamped with that organization.
 * `organizationId` absent is meaningful and correct in exactly one place — a
 * `single`-posture deployment, which has no organization for a row to belong
 * to — and is never a fallback for "we could not work out the organization".
 */
export function seedCtx(organizationId?: string): { isSystem: true; tenantId?: string } {
  return organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };
}

/** Does this posture want per-organization catalog rows? */
export function catalogIsPerOrganization(posture: TenancyPosture): boolean {
  return postureEnforcesWall(posture);
}

/**
 * Enumerate the organizations whose catalog needs seeding.
 *
 * Returns `null` — not `[]` — when the read FAILS, because the two mean
 * opposite things: zero organizations is "nothing to seed", an unreadable
 * `sys_organization` is "we do not know". Conflating them turns an outage into
 * a silent empty sweep, so a failure is warned and the caller must not proceed
 * as though the installation had no tenants.
 */
export async function listSeedOrganizationIds(
  ql: any,
  logger?: SeedLogger,
): Promise<string[] | null> {
  let rows: any;
  try {
    rows = await ql.find(ORGANIZATION_OBJECT, {
      fields: ['id'],
      limit: SEED_ORGANIZATION_SCAN_LIMIT,
      context: seedCtx(),
    });
  } catch (e) {
    logger?.warn?.(
      '[security] could not enumerate organizations — the RBAC catalog was NOT seeded per ' +
        'organization at this call; seeding retries on the next boot and on organization creation',
      { object: ORGANIZATION_OBJECT, error: (e as Error)?.message },
    );
    return null;
  }
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r: any) => r?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id !== '');
  if (ids.length >= SEED_ORGANIZATION_SCAN_LIMIT) {
    logger?.warn?.(
      '[security] organization scan hit its bound — organizations past it are seeded when they are ' +
        'created and on the next boot sweep',
      { scanned: ids.length, limit: SEED_ORGANIZATION_SCAN_LIMIT },
    );
  }
  return ids;
}

/** The organization a stored row belongs to, `null` for an organization-less one. */
export function rowOrganizationId(row: any): string | null {
  return (row?.organization_id ?? row?.organizationId) ?? null;
}

/**
 * Resolve THIS organization's own row for a name, out of what a tenant-scoped
 * read returned.
 *
 * A scoped read passes through `applyTenantScope`, whose compatibility arm
 * returns the caller's rows AND any organization-less ones. Those two are not
 * interchangeable and the seeders must never treat them as such:
 *
 * - a row stamped with `organizationId` is this organization's — update it;
 * - an organization-less row is a PRE-FIX residue that merely happens to be
 *   visible here. Reading it as "already seeded" is the silent no-op this
 *   catalog exists to prevent, so it is reported separately and never returned
 *   as the organization's own row.
 *
 * Under a `single`-posture pass (`organizationId` undefined) the
 * organization-less row IS the row, which is the carve-out, so it is returned
 * as `own` and nothing is flagged.
 */
export function resolveOwnOrganizationRow(
  rows: any[],
  organizationId?: string,
): { own: any | null; organizationLessResidue: any | null } {
  const list = Array.isArray(rows) ? rows : [];
  if (!organizationId) {
    return { own: list[0] ?? null, organizationLessResidue: null };
  }
  const own = list.find((r) => rowOrganizationId(r) === organizationId) ?? null;
  const residue = list.find((r) => rowOrganizationId(r) === null) ?? null;
  return { own, organizationLessResidue: residue };
}

/**
 * The machine-readable half of the guard below: WHY this organization-less row
 * is visible to a per-organization pass. The two answers take opposite
 * remedies, so the classification is a field rather than something a reader has
 * to infer from prose (#11532).
 */
export type OrganizationLessRowOrigin = 'platform-bucket' | 'pre-fix-residue';

/**
 * The loud guard that stands in place of a reap — and the ONE place that tells
 * the platform bucket apart from a genuine pre-fix leftover.
 *
 * Called once per pass with everything the pass found, so an operator gets ONE
 * actionable line per class rather than a warning per name.
 *
 * ## The two classes, and why conflating them was a defect (#11532)
 *
 * - **`pre-fix-residue`** — a row from before the per-organization conversion.
 *   Nothing regenerates it, so the ruled remedy holds: re-initialize the
 *   deployment (correct while it is pre-launch, which is the premise this whole
 *   repair was ruled on), or adopt each row by hand.
 *
 * - **`platform-bucket`** — a name `bootstrapPlatformAdmin` still seeds
 *   organization-less on EVERY boot (`platformBucketNames`). Calling one of
 *   these "pre-fix" tells an operator they are carrying legacy state they never
 *   had: on the measured fresh walled rig they were minted 1.3 s before the
 *   first organization existed, by the very code that then warned about them.
 *   And the pre-fix remedy does not terminate here — re-initializing recreates
 *   exactly these rows on the next boot, so the only branch that ends is hand
 *   adoption, which is also the branch an operator is least likely to pick and
 *   which hands a platform-wide bucket to one tenant.
 *
 * Membership is decided by NAME, not by `managed_by`, because the question the
 * remedy turns on is "will a re-initialized deployment have this row again?" —
 * and for these names it will, whatever provenance the current row carries (a
 * pre-#8692 install stores `'admin'` on the very same names).
 *
 * The pass that emits either warning has ALREADY created the organization's own
 * copies — both describe rows beside that catalog, never a refusal to seed.
 */
export function warnOrganizationLessRows(
  logger: SeedLogger | undefined,
  object: string,
  names: string[],
  organizationId: string,
  platformBucketNames?: Iterable<string>,
): void {
  if (names.length === 0) return;
  const bucketNames = new Set(platformBucketNames ?? []);
  const bucket = names.filter((n) => bucketNames.has(n));
  const residue = names.filter((n) => !bucketNames.has(n));

  if (bucket.length > 0) {
    logger?.warn?.(
      `[security] organization-less ${object} rows for the PLATFORM BUCKET are visible to this ` +
        `organization's pass. They are not leftovers from an older release: bootstrapPlatformAdmin ` +
        `seeds these names without an organization on every boot, including the one that just ran, ` +
        `and the ruling of 2026-08-20 keeps it that way (unreaped, reported, outside the ` +
        `per-organization conversion) because the platform-admin grant points at the ` +
        `admin_full_access row by id. This organization's own copies WERE created, so its catalog ` +
        `is complete and no action is required. Re-initializing the deployment does NOT clear ` +
        `them — the next boot mints them again. Adopting one by hand (stamping it with an ` +
        `organization) does remove it from this list, but hands a platform-wide row to a single ` +
        `tenant, so do that only if that is what you mean.`,
      {
        object,
        organization: organizationId,
        origin: 'platform-bucket' satisfies OrganizationLessRowOrigin,
        names: [...bucket].sort(),
        count: bucket.length,
      },
    );
  }

  if (residue.length > 0) {
    logger?.warn?.(
      `[security] pre-fix organization-less ${object} rows are still present for names this ` +
        `organization seeds — under a walled posture a row that belongs to no organization is ` +
        `invalid state, not a platform-wide default. This organization's own rows WERE created, so ` +
        `its catalog is complete; the leftovers below are readable through the driver's ` +
        `compatibility arm and belong to nobody. Remedy: re-initialize the deployment, or adopt each ` +
        `row by hand by stamping it with the organization that should own it. They are NOT deleted ` +
        `automatically — grants (sys_user_position, sys_position_permission_set, ` +
        `sys_user_permission_set) point at these row ids, so reaping them would revoke standing ` +
        `access with no signal at the moment of loss.`,
      {
        object,
        organization: organizationId,
        origin: 'pre-fix-residue' satisfies OrganizationLessRowOrigin,
        names: [...residue].sort(),
        count: residue.length,
      },
    );
  }
}

/**
 * Does a stored row already carry every field a pass would write?
 *
 * The boot sweep is O(CHANGED DECLARATIONS), not O(organizations x rows) of
 * blind writes: a pass reads what the organization already has (one bounded
 * read), compares it against the declaration, and issues an update only where
 * something actually differs. On the overwhelmingly common boot — nothing
 * declared changed since the last one — every organization costs its reads and
 * ZERO writes. Steady state does not ride this sweep at all; it rides the
 * organization-creation hook, which seeds exactly the one new organization.
 *
 * Compared loosely on purpose: a column absent from a legacy row and a
 * declaration that names it as `null`/`undefined` are the same state, and
 * treating them as different would make every boot re-write every row, which is
 * the cost this predicate exists to avoid.
 */
export function rowMatchesDeclaration(row: any, fields: Record<string, unknown>): boolean {
  if (!row) return false;
  for (const [key, want] of Object.entries(fields)) {
    const has = row[key];
    if ((has ?? null) === (want ?? null)) continue;
    if (typeof want === 'boolean' && Boolean(has) === want) continue;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------- *
 *  Refused catalog writes — the loud half of a seed that landed nothing
 * ------------------------------------------------------------------------- */

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

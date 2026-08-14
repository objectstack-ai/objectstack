// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapSystemCapabilities — back-compat seed the capability registry
 * (ADR-0066 D1).
 *
 * Promotes the platform's authorization capabilities from bare strings to
 * first-class `sys_capability` records. Idempotently upserts (by `name`):
 *   1. a CURATED set of well-known platform capabilities (label/description/
 *      scope), and
 *   2. any capability referenced by the seeded permission sets'
 *      `systemPermissions[]` that isn't in the curated set (derived defaults),
 * so every string a default grant references resolves to a definition record
 * while existing string references keep working unchanged (no migration).
 *
 * Pre-launch posture: upsert only — never prune (admins may add their own
 * capabilities in Setup; package-declared capabilities arrive via their own
 * seeding). Platform-seeded rows are `managed_by: 'platform'` so they are not
 * presented as admin-deletable. Runs on `kernel:ready` alongside the other
 * security bootstraps.
 *
 * [#5876] The two halves have DIFFERENT authority over an existing row's
 * display fields, because they have different claims to authorship:
 *   - CURATED — the platform authored `label`/`description`, and a new version
 *     may ship new copy, so the row it finds is refreshed;
 *   - DERIVED — there is no authored copy at all, only `humanize(name)` and
 *     `Capability <name>.` generated from a granted string, so it refreshes
 *     only its OWN placeholder (`managed_by:'platform'` on a non-curated name)
 *     and never a row an admin or a package authored.
 * The seed loop used to refresh both alike while the comment in front of it
 * claimed admin edits were preserved — what #2909 T3 actually made seed-once is
 * `scope`, and only `scope`.
 *
 * [#8470] The CURATED half looks up THE ROW THE PLATFORM OWNS, not the first row
 * that happens to share the name.
 *
 * `tryFind` runs under `SYSTEM_CTX`, which carries no `tenantId`: the security
 * middleware short-circuits on `isSystem` before Layer 0 is composed, and the
 * engine's `buildDriverOptions` sets a driver tenant scope only when
 * `execCtx.tenantId !== undefined`. The lookup therefore reads ACROSS
 * organizations by construction — which is correct for a seeder, and is exactly
 * why the predicate has to say which row it means.
 *
 * Since #8461 made `sys_capability.name` unique per ORGANIZATION rather than per
 * installation (ADR-0120 D1, the cross-tenant existence oracle #8323 reports), an
 * admin may author `manage_users` inside their organization while the platform
 * holds its own row in the NULL-organization bucket. A lookup on `{ name }` alone
 * then has two candidates and picks between them on grounds unrelated to
 * ownership, with two harms: an organization's authored copy is overwritten with
 * the platform's at every boot, and — when the org row is the one selected before
 * the platform's row exists — the curated row is NEVER INSERTED, in any bucket,
 * installation-wide.
 *
 * Note what the remedy is NOT. "Give the lookup an ORDER BY" was already true and
 * did not help: #4363's pagination tie-breaker appends `ORDER BY id ASC` to any
 * paged read of a driver-managed table, and `limit: 1` counts as paged on both
 * `SqlDriver` and `MongoDBDriver` (only `findOne` opts out via
 * `singleRowLookup`). So this lookup was already DETERMINISTIC on the shipped
 * drivers — deterministic on `id`, a key with no relationship whatsoever to who
 * owns the row, and stable per installation, so a boot that reconciles the wrong
 * row keeps reconciling it forever rather than self-healing. Determinism was
 * never the missing property; OWNERSHIP was.
 *
 * The predicate is therefore `managed_by: 'platform'` AND `organization_id: null`
 * — the two facts that jointly define "the platform's own row". They also make
 * the result set provably a singleton, which is what retires the ordering
 * question rather than answering it: the post-#8461 unique key is
 * `(COALESCE(organization_id, …), name)`, so the NULL-organization bucket admits
 * at most ONE row per name, and `limit: 1` over a set of size ≤ 1 cannot be
 * arbitrary. `managed_by` alone would not carry that guarantee (a platform-marked
 * row sitting inside an organization — from seed data or a legacy import — would
 * restore the two-candidate state), and `organization_id` alone would not
 * distinguish the platform's row from an admin's in a single-organization
 * deployment, where both live in the same bucket.
 *
 * The DERIVED half's lookup is deliberately UNCHANGED (its own guard, #5876,
 * already refuses to touch a row it does not own).
 */

import { PLATFORM_CAPABILITIES, type PlatformCapability } from '@objectstack/spec/security';

const SYSTEM_CTX = { isSystem: true };

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryFind(ql: any, object: string, where: any, limit = 1): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try { return await ql.insert(object, data, { context: SYSTEM_CTX }); } catch { return null; }
}
async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try { await ql.update(object, data, { context: SYSTEM_CTX }); return true; } catch { return false; }
}

type CapabilityDef = PlatformCapability;

/**
 * Well-known platform capabilities. Re-exported from the canonical spec registry
 * (`@objectstack/spec/security` `PLATFORM_CAPABILITIES`) so the seeder and the
 * authoring lint (ADR-0066 ⑨) share ONE source of truth. `managed_by` is always
 * `'platform'` for these. Kept as a named export for back-compat consumers/tests.
 */
export const KNOWN_CAPABILITIES: readonly CapabilityDef[] = PLATFORM_CAPABILITIES;

function humanize(name: string): string {
  return name
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SeedOptions {
  logger?: { info?: (m: string, meta?: Record<string, any>) => void; warn?: (m: string, meta?: Record<string, any>) => void };
  /**
   * [ADR-0066 D1] Capability names that `bootstrapDeclaredCapabilities` has
   * confirmed ALREADY HAVE a `sys_capability` row
   * ({@link CapabilitySeedOutcome.materializedNames}). The implicit
   * derived-defaults path SKIPS these so it never overwrites an authored
   * capability's label/description (or its package provenance) with a humanized
   * placeholder. Curated platform capabilities are unaffected.
   *
   * [#4967 Part 1] "Materialized", NOT "declared": a declaration the seeder
   * REFUSED (no owning package) writes no row, so suppressing the derivation
   * for it left the capability existing in no row at all and every
   * `systemPermissions` grant naming it inert. Such a name is deliberately
   * absent from this list and derives its placeholder as it always did.
   */
  materializedCapabilityNames?: Iterable<string>;
}

/** Aggregated outcome of a back-compat capability seeding pass. */
export interface CapabilitySeedResult {
  /** Rows inserted (curated definitions + derived placeholders). */
  seeded: number;
  /** Rows whose platform display fields were reconciled. */
  updated: number;
  /**
   * [#5876] Derived names whose existing row is authored elsewhere
   * (`managed_by` anything but `'platform'`), so its `label`/`description` were
   * left as their author wrote them. Not a degradation — the capability
   * resolves and the authored copy is the better one — so it is reported in the
   * boot summary rather than warned about (#4632).
   */
  skippedAuthored: number;
  /**
   * [#8470] Curated definitions whose platform row is ABSENT and could not be
   * written, because a row this pass does not own already holds the name in the
   * NULL-organization bucket (a Setup-authored row on a single-organization
   * deployment, or a package row that claimed a curated name).
   *
   * This counter exists because the alternative is silence in both directions.
   * Before the ownership-scoped lookup the seeder resolved that collision by
   * OVERWRITING the other author's row; now it correctly declines to — but
   * `tryInsert` swallows the engine's unique-constraint refusal, so declining
   * would otherwise look exactly like a clean boot while a curated capability is
   * missing from the registry installation-wide. Counted and warned, never
   * silent.
   */
  blockedCurated: number;
  /** Definitions considered this pass (curated + derived). */
  total: number;
}

export async function bootstrapSystemCapabilities(
  ql: any,
  permissionSets: Array<{ systemPermissions?: string[] }> = [],
  options: SeedOptions = {},
): Promise<CapabilitySeedResult> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0, skippedAuthored: 0, blockedCurated: 0, total: 0 };
  }

  const materialized = new Set<string>(options.materializedCapabilityNames ?? []);

  // Build the full definition set: curated first, then any extra capability
  // string referenced by the seeded permission sets (derived defaults) — EXCEPT
  // ones that already have a row, which the declared seeder owns.
  const byName = new Map<string, CapabilityDef>();
  for (const c of KNOWN_CAPABILITIES) byName.set(c.name, c);
  // [#5876] Which names came from the DERIVED half. The two halves carry
  // different authority over an existing row's display fields (see the
  // reconcile guard below), and after this loop `byName` cannot tell them
  // apart on its own.
  const derivedNames = new Set<string>();
  for (const ps of permissionSets) {
    for (const cap of ps?.systemPermissions ?? []) {
      if (typeof cap === 'string' && cap && !byName.has(cap) && !materialized.has(cap)) {
        byName.set(cap, { name: cap, label: humanize(cap), description: `Capability ${cap}.`, scope: 'platform' });
        derivedNames.add(cap);
      }
    }
  }

  let seeded = 0;
  let updated = 0;
  let skippedAuthored = 0;
  let blockedCurated = 0;
  for (const def of byName.values()) {
    const isDerived = derivedNames.has(def.name);
    // [#8470] CURATED: address the platform's OWN row. DERIVED: unchanged — its
    // own `managed_by` guard below is what keeps it off rows it does not own
    // (#5876), and narrowing its lookup here would change a half this card
    // deliberately leaves alone.
    const lookup = isDerived
      ? { name: def.name }
      : { name: def.name, managed_by: 'platform', organization_id: null };
    const existing = await tryFind(ql, 'sys_capability', lookup, 1);
    const row = existing[0];
    if (row?.id) {
      // [#5876] Reconcile display fields only where THIS pass owns the copy.
      //
      // A DERIVED name has no authored copy to ship: `label` is `humanize(name)`
      // and `description` is `Capability <name>.`, both generated from the
      // string a permission set happened to grant. Refreshing those onto a row
      // somebody else authored is not reconciliation, it is overwriting an
      // author with a placeholder — every boot, silently. For a non-curated
      // name a `managed_by:'platform'` row can only be this same derivation's
      // placeholder from an earlier boot, so that is exactly the set of rows
      // the derived half may refresh; `admin` (Setup-authored), `package`
      // (declared by its owning package) and anything else are left alone.
      //
      // The CURATED half is unchanged: those definitions are authored by the
      // platform and a new version legitimately ships new copy, so a curated
      // name still refreshes the row it finds.
      //
      // NOTE this is the WRITE-side enforcement of the same rule
      // `materializedCapabilityNames` states at the CALL site (#4967 Part 1):
      // the caller says which names another pass already materialized, and
      // this guard holds even when nothing said so — an admin row for a name
      // no package ever declared is invisible to that list.
      if (isDerived && row.managed_by !== 'platform') {
        skippedAuthored += 1;
        continue;
      }
      // Keep label/description fresh from the platform's own definition.
      // `scope` is an admin-editable classification face (plain select on
      // sys_capability), so it is seed-once: written on insert, never
      // refreshed (#2909 T3). A curated scope change in a new platform version
      // needs a data migration — recorded in the ADR-0094 addendum.
      if (await tryUpdate(ql, 'sys_capability', { id: row.id, label: def.label, description: def.description })) {
        updated += 1;
      }
    } else {
      const created = await tryInsert(ql, 'sys_capability', {
        id: genId('cap'),
        name: def.name,
        label: def.label,
        description: def.description,
        scope: def.scope,
        managed_by: 'platform',
        active: true,
      });
      if (created) seeded += 1;
      else if (!isDerived) {
        // [#8470] The curated row is absent AND could not be written — the
        // NULL-organization bucket already holds the name under a row the
        // scoped lookup did not match. Report it: a curated capability missing
        // from the registry is the harm this card is about, and an unreported
        // one is indistinguishable from a clean boot (`tryInsert` swallows the
        // engine's unique-constraint refusal).
        //
        // The diagnostic states what was OBSERVED, and it costs one extra read
        // — on this branch only — to be able to. The seeder knows two things:
        // no row matched `managed_by:'platform' AND organization_id IS NULL`,
        // and the insert was refused. It does NOT know who authored the row
        // that blocked it, so it must not say "a row this pass does not own":
        // that is an ownership verdict, and on a hypothetical platform row
        // carrying some other `managed_by` the sentence would be false, printed
        // every boot. Read the blocking row's provenance and name it instead.
        //
        // Note this REPORTS the distinction; it deliberately does not ACT on
        // it. Adopting a differently-stamped row into the platform's identity
        // would reverse the #5876 ruling that "not provably ours" resolves to
        // leave-it-alone, and backfilling a stamp is a data migration. Both are
        // maintainer calls, and neither is made here.
        blockedCurated += 1;
        // THREE outcomes, not two. "No row came back" and "a row came back
        // carrying no managed_by" are different observations, and collapsing
        // them would repeat this branch's own defect one level down: the insert
        // WAS refused, so something blocked it, and a follow-up read that finds
        // nothing is a genuinely interesting state (a racing writer, or a
        // refusal that was never the unique key) — not an ordinary unstamped
        // row. Say which one was seen.
        const blocking = (await tryFind(ql, 'sys_capability', { name: def.name, organization_id: null }, 1))[0];
        const observation = blocking === undefined
          ? 'NO blocking row is visible there at all — so the refusal was not the unique key, or the ' +
            'row has gone since. That is not an ordinary collision and is worth investigating'
          : blocking.managed_by == null
            ? 'a row carrying no managed_by value already holds the name, and was left exactly as it is'
            : `a row with managed_by='${String(blocking.managed_by)}' already holds the name, and was ` +
              'left exactly as it is';
        // [#8552] The maintainer's ruling deliberately leaves an existing
        // colliding row to the OPERATOR (option 1: no adoption, no backfill),
        // so the warning that reports the collision owes them the one line
        // that says how to resolve it by hand. Only when a blocking row was
        // actually observed — telling an operator to rename a row the read
        // just failed to find would be asserting what was not seen.
        const remediation = blocking === undefined
          ? ''
          : ' To resolve by hand: rename the blocking row to a name outside the curated set (or delete ' +
            'it) — through Setup for an admin-authored row, or by editing and re-publishing the owning ' +
            "package for a package-declared one — then restart; the seeder will then seed the platform's " +
            'definition. (New Setup rows can no longer take a curated name — refused at the write door.)';
        options.logger?.warn?.(
          `[security] curated capability "${def.name}" has no platform row and could not be seeded. ` +
            'In the platform (NULL-organization) bucket, where the declared unique key admits one row ' +
            `per name: ${observation}. The platform definition is therefore missing from sys_capability ` +
            'installation-wide. Grants and requiredPermissions referencing the name are unaffected — ' +
            `they resolve by name, not by row.${remediation}`,
          { name: def.name, blockingRowId: blocking?.id, blockingManagedBy: blocking?.managed_by ?? null },
        );
      }
    }
  }
  options.logger?.info?.('[security] system capabilities seeded into sys_capability (ADR-0066 D1)', {
    seeded, updated, skippedAuthored, blockedCurated, total: byName.size,
  });
  return { seeded, updated, skippedAuthored, blockedCurated, total: byName.size };
}

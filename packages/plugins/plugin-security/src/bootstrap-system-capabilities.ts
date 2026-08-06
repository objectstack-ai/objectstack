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
  /** Definitions considered this pass (curated + derived). */
  total: number;
}

export async function bootstrapSystemCapabilities(
  ql: any,
  permissionSets: Array<{ systemPermissions?: string[] }> = [],
  options: SeedOptions = {},
): Promise<CapabilitySeedResult> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0, skippedAuthored: 0, total: 0 };
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
  for (const def of byName.values()) {
    const existing = await tryFind(ql, 'sys_capability', { name: def.name }, 1);
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
      if (derivedNames.has(def.name) && row.managed_by !== 'platform') {
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
    }
  }
  options.logger?.info?.('[security] system capabilities seeded into sys_capability (ADR-0066 D1)', {
    seeded, updated, skippedAuthored, total: byName.size,
  });
  return { seeded, updated, skippedAuthored, total: byName.size };
}

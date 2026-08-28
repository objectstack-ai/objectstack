// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapBuiltinRoles — seed the framework's reserved built-in identity roles
 * (ADR-0068 D2) into `sys_position`.
 *
 * The four built-in roles (`platform_admin`, `org_owner`, `org_admin`,
 * `org_member`) are a normalized PROJECTION surfaced in `current_user.positions`.
 * Seeding their `sys_position` rows makes the role catalog (consumed by role-bound
 * permission sets, sharing-rule recipients, and the ADR-0068 D4 role-catalog
 * validator) self-describing and AI-groundable. Their SOURCES OF TRUTH —
 * `sys_member.role` for the org_* roles and the unscoped `admin_full_access`
 * grant for platform_admin — are NEVER changed by this seed.
 *
 * Idempotent upsert by `(name, organization_id)`, no prune. Rows are stamped
 * `managed_by = 'platform'` (A4 #2920 unified vocab; formerly 'system') so
 * tenants can see (but not repurpose) them. Runs on `kernel:ready` alongside the
 * platform-admin and declared-role bootstraps, and again for each organization
 * as it is created.
 *
 * ## Per organization under a walled posture
 *
 * The built-in names are seeded PER ORGANIZATION, copies and all. That is the
 * ruled reading of what these rows are: `sys_position` spells its name index
 * `unique: 'organization'`, `sys_user_position` assignments are already
 * per-organization, and a walled tenant that cannot SEE `everyone` cannot bind
 * anything to it. What is not copied is the SOURCE OF TRUTH behind the names —
 * `sys_member.role` for the org_* roles and the unscoped `admin_full_access`
 * grant for `platform_admin` — exactly as before: this seed remains a catalog
 * projection, so per-organization copies of the catalog change no derivation.
 *
 * A `single`-posture deployment keeps exactly one organization-less pass. See
 * `per-organization-catalog.ts` for the doctrine and for the loud guard that
 * stands in place of a reap.
 */

import { BUILTIN_IDENTITY_NAMES, BUILTIN_IDENTITY_METADATA, EVERYONE_POSITION, GUEST_POSITION } from '@objectstack/spec';
import {
  createSeedWriteRefusals,
  resolveOwnOrganizationRow,
  rowMatchesDeclaration,
  seedCtx,
  warnOrganizationLessRows,
  warnSeedWriteRefusals,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';

/**
 * [ADR-0090 D5/D9] Audience anchors seeded alongside the identity names.
 * `everyone` — implicit for every authenticated member; its bindings are the
 * tenant's default grants. `guest` — implicit for unauthenticated principals.
 * Both are system-managed and undeletable like the identity rows.
 */
const AUDIENCE_ANCHOR_METADATA: Record<string, { label: string; description: string }> = {
  [EVERYONE_POSITION]: {
    label: 'Everyone',
    description:
      'Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant (ADR-0090 D5). High-privilege sets cannot be bound here.',
  },
  [GUEST_POSITION]: {
    label: 'Guest',
    description:
      'Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard (ADR-0090 D9).',
  },
};

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryFind(ql: any, object: string, where: any, limit = 100, organizationId?: string): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: seedCtx(organizationId) });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
// ⛔ The `catch` RECORDS before it answers — see the sibling in
// `bootstrap-declared-positions.ts`. Answering `null`/`false` alone is what
// made a refused write indistinguishable from "nothing to do".
async function tryInsert(
  ql: any, object: string, data: any, organizationId?: string, refusals?: SeedWriteRefusals,
): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: seedCtx(organizationId) });
  } catch (e) { refusals?.record(object, e); return null; }
}
async function tryUpdate(
  ql: any, object: string, data: any, organizationId?: string, refusals?: SeedWriteRefusals,
): Promise<boolean> {
  try {
    await ql.update(object, data, { context: seedCtx(organizationId) }); return true;
  } catch (e) { refusals?.record(object, e); return false; }
}

interface SeedOptions {
  logger?: { info: (m: string, meta?: Record<string, any>) => void; warn: (m: string, meta?: Record<string, any>) => void };
  /**
   * Seed THIS organization's copies. Omitted = the `single`-posture pass, the
   * one place an organization-less catalog row is the correct shape.
   */
  organizationId?: string;
}

export async function bootstrapBuiltinRoles(
  ql: any,
  options: SeedOptions = {},
): Promise<{ seeded: number; updated: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0 };
  }
  const organizationId = options.organizationId;
  let seeded = 0;
  let updated = 0;
  let unchanged = 0;
  const residue: string[] = [];
  // One log per pass, not per refused row (see the sibling seeders).
  const refusals = createSeedWriteRefusals();
  const rows: Array<[string, { label: string; description: string }]> = [
    ...BUILTIN_IDENTITY_NAMES.map((n) => [n, BUILTIN_IDENTITY_METADATA[n]] as [string, { label: string; description: string }]),
    ...Object.entries(AUDIENCE_ANCHOR_METADATA),
  ];
  for (const [name, meta] of rows) {
    // [A4 #2920] Unified provenance vocab: built-in identity/anchor positions are
    // PLATFORM-shipped (formerly stamped 'system'). Re-upserted every boot, so
    // legacy 'system' rows self-heal to 'platform' on the next kernel:ready.
    const fields = { label: meta.label, description: meta.description, managed_by: 'platform' };
    // Limit 5, not 1: a tenant-scoped read passes through `applyTenantScope`,
    // whose compatibility arm returns organization-less rows alongside this
    // organization's own. Asking for one row would hand back whichever the
    // driver ordered first — and taking a pre-fix organization-less row as
    // "already seeded" is exactly the silent no-op this pass must not perform.
    const existing = await tryFind(ql, 'sys_position', { name }, 5, organizationId);
    const { own, organizationLessResidue } = resolveOwnOrganizationRow(existing, organizationId);
    if (organizationLessResidue) residue.push(name);
    if (own?.id) {
      // O(changed declarations): an unchanged row costs no write at all.
      if (rowMatchesDeclaration(own, fields)) { unchanged += 1; continue; }
      if (await tryUpdate(ql, 'sys_position', { id: own.id, ...fields }, organizationId, refusals)) updated += 1;
    } else {
      const created = await tryInsert(ql, 'sys_position', {
        id: genId('position'), name, ...fields, active: true, is_default: false,
      }, organizationId, refusals);
      if (created) seeded += 1;
    }
  }
  if (organizationId) {
    // See the sibling in `bootstrap-declared-positions.ts`: no organization-less
    // writer survives for `sys_position`, so no platform bucket is declared.
    warnOrganizationLessRows(options.logger, 'sys_position', residue, organizationId);
  }
  // Before the counts, so an operator reads WHY the count is zero beside it.
  warnSeedWriteRefusals(options.logger, refusals, organizationId);
  if (seeded + updated > 0) {
    options.logger?.info?.('[security] built-in identity names + audience anchors seeded into sys_position', {
      seeded, updated, unchanged, total: rows.length, ...(organizationId ? { organization: organizationId } : {}),
    });
  }
  return { seeded, updated };
}

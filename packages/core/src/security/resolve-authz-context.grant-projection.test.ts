// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The prelude's `sys_user_permission_set` read names the columns the resolver
 * decides on — the set, the organization and the validity window — so the
 * engine computes no formula field of the grant table for it. A formula a read
 * does not name is never computed, and one that reads through a lookup (a
 * record title naming the person) would otherwise cost a read and a round trip
 * in every request a grant holder makes.
 *
 * What is pinned: a projection is only right if it drops nothing the resolver
 * reads. The resolved envelope is therefore resolved twice per fixture, on the
 * recording double the batch-equivalence suite drives —
 *
 *  - over FULL rows, every stored column plus a computed title, which is what
 *    the read returned when it named no columns; and
 *  - over PROJECTED rows, the named columns only and no `id`, which is what a
 *    driver answers a projection with (driver-sql: exactly the named columns);
 *
 * and the two envelopes must be identical, whole. Each grant state the
 * resolver discriminates is a fixture of its own: an active grant, an expired
 * one, one not yet valid, one owned by the active organization, one owned by
 * another, a deployment-wide one (`organization_id` null) and an
 * `admin_full_access` grant owned by the Default Organization, which anchors
 * platform standing. Dropping any one of the four columns from the read turns
 * at least one fixture red. The batch-equivalence matrix runs through the same
 * comparison.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { FIXTURES, T0, makeRecordingQl } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';
import { bindStaticSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const DEFAULT_ORG = 'org_default';
const DAY = 86_400_000;
const past = new Date(T0 - DAY).toISOString();
const future = new Date(T0 + DAY).toISOString();

const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
let ambient: Record<string, string | undefined> = {};
beforeAll(() => {
  ambient = { [OWNER_ENV]: process.env[OWNER_ENV], [POSTURE_ENV]: process.env[POSTURE_ENV] };
  delete process.env[OWNER_ENV];
  delete process.env[POSTURE_ENV];
  resetPlatformAdminEmailMemo();
});
afterAll(() => {
  for (const [k, v] of Object.entries(ambient)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPlatformAdminEmailMemo();
});

/** The definitions the catalog holds; each grant fixture names one. */
const definitions = {
  permissions: [
    { name: ADMIN_FULL_ACCESS, systemPermissions: ['manage_users'] },
    { name: 'tools', systemPermissions: ['cap_tools'], tabPermissions: { crm: 'visible' } },
    { name: 'reports', systemPermissions: ['cap_reports'] },
  ],
  positions: [] as Array<Record<string, unknown>>,
};

/** A grant row as stored: every column the object declares, and the title a full read computes. */
const grantRow = (id: string, cols: Record<string, unknown>) => ({
  id,
  user_id: 'u1',
  permission_set: null,
  organization_id: null,
  granted_by: 'u_granter',
  valid_from: null,
  valid_until: null,
  reason: 'pinned',
  created_at: past,
  ...cols,
  display_title: `Ursula → ${String(cols.permission_set)}`,
});

interface GrantFixture {
  name: string;
  grants: Array<Record<string, unknown>>;
  tenantId?: string;
}

const GRANT_FIXTURES: GrantFixture[] = [
  { name: 'an active grant owned by the active organization', tenantId: ORG_A,
    grants: [grantRow('g_active', { permission_set: 'tools', organization_id: ORG_A })] },
  { name: 'an active grant owned by another organization', tenantId: ORG_A,
    grants: [grantRow('g_other', { permission_set: 'tools', organization_id: ORG_B })] },
  { name: 'an expired grant', tenantId: ORG_A,
    grants: [grantRow('g_expired', { permission_set: 'tools', organization_id: ORG_A, valid_until: past })] },
  { name: 'a grant not yet valid', tenantId: ORG_A,
    grants: [grantRow('g_pending', { permission_set: 'tools', organization_id: ORG_A, valid_from: future })] },
  { name: 'a grant inside its window', tenantId: ORG_A,
    grants: [grantRow('g_window', { permission_set: 'tools', organization_id: ORG_A, valid_from: past, valid_until: future })] },
  { name: 'a deployment-wide grant (organization_id null), in an organization', tenantId: ORG_A,
    grants: [grantRow('g_global', { permission_set: 'reports', organization_id: null })] },
  { name: 'a deployment-wide grant (organization_id null), with no organization active',
    grants: [grantRow('g_global', { permission_set: 'reports', organization_id: null })] },
  { name: 'an admin_full_access grant owned by the Default Organization, acting in another', tenantId: ORG_A,
    grants: [grantRow('g_admin', { permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG })] },
  { name: 'an admin_full_access grant owned by the Default Organization, with none active',
    grants: [grantRow('g_admin', { permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG })] },
  { name: 'an expired admin_full_access grant', tenantId: ORG_A,
    grants: [grantRow('g_admin_lapsed', { permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG, valid_until: past })] },
  { name: 'an admin_full_access grant owned by another organization', tenantId: ORG_B,
    grants: [grantRow('g_admin_b', { permission_set: ADMIN_FULL_ACCESS, organization_id: ORG_B })] },
  { name: 'every state at once', tenantId: ORG_A,
    grants: [
      grantRow('g_active', { permission_set: 'tools', organization_id: ORG_A }),
      grantRow('g_expired', { permission_set: 'reports', organization_id: ORG_A, valid_until: past }),
      grantRow('g_pending', { permission_set: 'reports', organization_id: ORG_A, valid_from: future }),
      grantRow('g_global', { permission_set: 'reports', organization_id: null }),
      grantRow('g_admin', { permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG }),
    ] },
];

const tablesFor = (grants: Array<Record<string, unknown>>): Record<string, unknown[]> => ({
  sys_user: [{ id: 'u1', email: 'u1@example.com', name: 'Ursula' }],
  sys_member: [
    { user_id: 'u1', organization_id: ORG_A, role: 'member' },
    { user_id: 'u1', organization_id: ORG_B, role: 'member' },
  ],
  sys_user_position: [],
  sys_user_permission_set: grants,
  sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }, { id: ORG_A, slug: 'a' }, { id: ORG_B, slug: 'b' }],
  sys_metadata_activation: [],
});

/** The `fields` each read carried, by object, in issue order. */
type Projections = Array<{ object: string; fields: unknown }>;

/**
 * The recording double, answering a projection the way a driver does — the
 * named columns and nothing else, `id` included only when named — or, with
 * `projecting: false`, ignoring it and answering every column as a read that
 * named none did.
 */
function engineOver(tables: Record<string, unknown[]>, projecting: boolean, catalog?: typeof definitions) {
  const ql: any = makeRecordingQl(tables);
  if (catalog) bindStaticSecurityCatalog(ql, catalog);
  const projections: Projections = [];
  const find = ql.find.bind(ql);
  ql.find = async (object: string, opts: any) => {
    projections.push({ object, fields: opts?.fields });
    const rows: Array<Record<string, unknown>> = await find(object, opts);
    if (!projecting || !Array.isArray(opts?.fields)) return rows;
    return rows.map((row) => Object.fromEntries(opts.fields.filter((f: string) => f in row).map((f: string) => [f, row[f]])));
  };
  return { ql, projections };
}

async function resolveBoth(
  userId: string,
  tables: Record<string, unknown[]>,
  opts: Record<string, unknown>,
  catalog?: typeof definitions,
) {
  const full = engineOver(tables, false, catalog);
  const projected = engineOver(tables, true, catalog);
  return {
    full: await resolveUserAuthzGrants(full.ql, userId, opts as never),
    projected: await resolveUserAuthzGrants(projected.ql, userId, opts as never),
    projections: projected.projections,
  };
}

describe('the prelude\'s grant read names the columns the resolver decides on', () => {
  it('the grant read names exactly permission_set, organization_id, valid_from and valid_until — no other read names any', async () => {
    const { projections } = await resolveBoth('u1', tablesFor(GRANT_FIXTURES.at(-1)!.grants), { tenantId: ORG_A, nowMs: T0 }, definitions);
    const grantReads = projections.filter((p) => p.object === 'sys_user_permission_set');
    expect(grantReads).toHaveLength(1);
    expect([...(grantReads[0]!.fields as string[])].sort()).toEqual(['organization_id', 'permission_set', 'valid_from', 'valid_until']);
    // No other read in the prelude changes.
    expect(projections.filter((p) => p.object !== 'sys_user_permission_set' && p.fields !== undefined)).toEqual([]);
  });

  describe.each(GRANT_FIXTURES)('$name', ({ grants, tenantId }) => {
    it('resolves the identical envelope from the projected rows as from the full rows', async () => {
      const opts = { ...(tenantId ? { tenantId } : {}), nowMs: T0 };
      const { full, projected } = await resolveBoth('u1', tablesFor(grants), opts, definitions);
      expect(projected).toEqual(full);
    });
  });

  it('the fixtures discriminate: they resolve distinct envelopes, platform standing among them', async () => {
    const seen = new Set<string>();
    let platformAdmin = 0;
    for (const { grants, tenantId } of GRANT_FIXTURES) {
      const { projected } = await resolveBoth('u1', tablesFor(grants), { ...(tenantId ? { tenantId } : {}), nowMs: T0 }, definitions);
      seen.add(JSON.stringify(projected));
      if (projected.posture === 'PLATFORM_ADMIN') platformAdmin += 1;
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(platformAdmin).toBe(3);
  });

  describe.each(FIXTURES)('batch-equivalence fixture $name', (fixture) => {
    it('resolves the identical envelope from the projected rows as from the full rows', async () => {
      const { full, projected } = await resolveBoth(fixture.userId, fixture.tables, fixture.opts as Record<string, unknown>);
      expect(projected).toEqual(full);
    });
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The external population's stamp at the resolver's one provisioning boundary
// (ruling of record 6355206139, letter B, stage 1, E1): `sys_member.role =
// external` in the ACTIVE organization projects to `org_external`, and its
// holder does not hold the `everyone` audience anchor — so the deployment's
// default sets bound there (the platform baseline, an app's `isDefault` set,
// an accepted package default) never reach it. What reaches it is what its own
// identity position names, plus its explicit grants. An ordinary member is
// unchanged, and the stamp is per organization.

import { describe, it, expect } from 'vitest';
import { countPositionHolders, resolveUserAuthzGrants } from './resolve-authz-context.js';
import { bindStaticSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ALPHA = 'org_alpha';
const BETA = 'org_beta';

function makeQl(tables: Record<string, any[]>) {
  return {
    async find(object: string, opts: any) {
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`test double: combinator ${k} is not implemented`);
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          if (v === null) return (r[k] ?? null) === null;
          return r[k] === v;
        }),
      );
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
  };
}

/** The catalog every case reads: the anchor's baseline, the external identity's own set, one portal grant. */
const definitions = {
  positions: [
    { name: 'everyone', permissionSets: ['member_default', 'app_default'] },
    { name: 'org_external', permissionSets: ['external_default'] },
    { name: 'supplier_a_portal', permissionSets: ['supplier_portal'] },
  ],
  permissions: [
    { name: 'member_default' },
    { name: 'app_default' },
    { name: 'external_default' },
    { name: 'supplier_portal' },
  ],
};

const principal = (members: any[], positions: any[] = []) =>
  bindStaticSecurityCatalog(
    makeQl({
      sys_user: [{ id: 'u1', email: 'u1@x.test' }, { id: 'u2', email: 'u2@x.test' }, { id: 'u3', email: 'u3@x.test' }],
      sys_member: members,
      sys_user_position: positions,
      sys_user_permission_set: [],
    }),
    definitions,
  );

describe('the external population at the provisioning boundary', () => {
  it('an external member holds org_external and not everyone: only its own set and its explicit grants', async () => {
    const ql = principal(
      [{ user_id: 'u1', organization_id: ALPHA, role: 'external' }],
      [{ user_id: 'u1', position: 'supplier_a_portal', organization_id: ALPHA }],
    );
    const grants = await resolveUserAuthzGrants(ql, 'u1', { tenantId: ALPHA });
    expect(grants.positions).toContain('org_external');
    expect(grants.positions).toContain('supplier_a_portal');
    expect(grants.positions).not.toContain('everyone');
    expect(grants.positions).not.toContain('org_member');
    expect([...grants.permissions].sort()).toEqual(['external_default', 'supplier_portal']);
  });

  it('an ordinary member is unchanged: everyone, and the baseline it names', async () => {
    const ql = principal([{ user_id: 'u2', organization_id: ALPHA, role: 'member' }]);
    const grants = await resolveUserAuthzGrants(ql, 'u2', { tenantId: ALPHA });
    expect(grants.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(grants.positions).not.toContain('org_external');
    expect([...grants.permissions].sort()).toEqual(['app_default', 'member_default']);
  });

  it('the stamp is per organization: external in one, a member in the other', async () => {
    const ql = principal([
      { user_id: 'u3', organization_id: ALPHA, role: 'external' },
      { user_id: 'u3', organization_id: BETA, role: 'member' },
    ]);
    const inAlpha = await resolveUserAuthzGrants(ql, 'u3', { tenantId: ALPHA });
    expect(inAlpha.positions).not.toContain('everyone');
    expect([...inAlpha.permissions].sort()).toEqual(['external_default']);
    const inBeta = await resolveUserAuthzGrants(ql, 'u3', { tenantId: BETA });
    expect(inBeta.positions).toContain('everyone');
    expect(inBeta.positions).not.toContain('org_external');
    expect([...inBeta.permissions].sort()).toEqual(['app_default', 'member_default']);
  });

  it('with no active organization an external membership withholds the anchor (fail closed)', async () => {
    const ql = principal([
      { user_id: 'u3', organization_id: ALPHA, role: 'external' },
      { user_id: 'u3', organization_id: BETA, role: 'member' },
    ]);
    const grants = await resolveUserAuthzGrants(ql, 'u3', {});
    expect(grants.positions).toContain('org_external');
    expect(grants.positions).not.toContain('everyone');
    expect(grants.permissions).not.toContain('member_default');
  });

  it('the holder count agrees: an external is counted under org_external, never under everyone', async () => {
    const ql = principal([
      { user_id: 'u1', organization_id: ALPHA, role: 'external' },
      { user_id: 'u2', organization_id: ALPHA, role: 'member' },
    ]);
    const counts = await countPositionHolders(ql, ALPHA, ['everyone', 'org_external', 'org_member']);
    expect(counts.get('everyone')).toBe(1);
    expect(counts.get('org_external')).toBe(1);
    expect(counts.get('org_member')).toBe(1);
  });
});

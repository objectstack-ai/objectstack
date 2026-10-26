// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10757] The serial ROUNDS an authenticated request pays inside
 * `resolveUserAuthzGrants`, pinned beside the envelope they produce.
 *
 * A local reading of an authenticated `GET /api/v1/data/OBJECT?$top=1` on the
 * stock showcase (local PostgreSQL, behind a +20 ms RTT proxy) counted, for
 * the seeded administrator, three rounds in this resolver: wave 1, then the
 * Default Organization read (`sys_organization` by slug), then the activation
 * ledger read (`sys_metadata_activation`), each awaited after the one before.
 * The last two depend on wave 1 only, so they are ONE wave now (leg 4).
 *
 * Every case below asserts three things together, because each alone passes
 * on a wrong implementation:
 *
 *  - the LEG count (the recording double opens a leg for a read that starts
 *    while nothing is in flight — `makeRecordingQl`), which is the win;
 *  - the resolved ENVELOPE, written out in full, which must not move;
 *  - the READS issued — objects, filters and limits — which must not move
 *    either, save the one recorded widening below.
 *
 * The envelopes and the reads were captured from the sequential version
 * (`origin/main` 913fd6df8a, `resolve-authz-context.ts` before this change)
 * on these exact fixtures; only the leg count differs (3 there, 2 here).
 *
 * ⛔ The organization read's filter and the organization-less readings it
 * feeds (`grantAppliesInTenant`, `grantAnchorsPlatformStanding`) are NOT edited
 * by this leg — the Default Organization read is still `{ slug: 'default' }`
 * limit 1, and the anchor is still asked of the same rows. Each case pins the
 * `sys_organization` read byte-for-byte.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';

import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { makeRecordingQl } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';

const NOW = Date.parse('2026-10-19T00:00:00.000Z');
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ENVS = [POSTURE_ENV, MULTI_ORG_ENV, OWNER_ENV] as const;

let ambient: Record<string, string | undefined> = {};
beforeEach(() => {
  ambient = Object.fromEntries(ENVS.map((k) => [k, process.env[k]]));
  // `single` — the stock showcase's posture — with no configured administrator.
  for (const k of ENVS) delete process.env[k];
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  for (const k of ENVS) {
    if (ambient[k] === undefined) delete process.env[k];
    else process.env[k] = ambient[k];
  }
  resetPlatformAdminEmailMemo();
});

/** The stock `single` promotion: the first user's `admin_full_access` grant, owned by the Default Organization. */
const promotedAdmin = (grantOrganization: string, organizations: Array<Record<string, unknown>>) => ({
  sys_user: [{ id: 'usr_1', email: 'admin@example.com' }],
  sys_member: [{ id: 'mem_1', user_id: 'usr_1', organization_id: 'org_default', role: 'owner' }],
  sys_user_position: [],
  sys_user_permission_set: [
    { id: 'ups_1', user_id: 'usr_1', permission_set: ADMIN_FULL_ACCESS, organization_id: grantOrganization },
  ],
  sys_permission_set: [{ id: 'pst_1', name: ADMIN_FULL_ACCESS, active: true }],
  sys_organization: organizations,
});
const DEFAULT_ONLY = [{ id: 'org_default', slug: 'default' }];

const ledgerReadOf = (names: string[]) => ({
  object: 'sys_metadata_activation',
  where: { metadata_type: { $in: ['position', 'permission'] }, name: { $in: names } },
  limit: names.length * 2,
  isSystem: true,
});
const DEFAULT_ORGANIZATION_READ = {
  object: 'sys_organization',
  where: { slug: 'default' },
  limit: 1,
  isSystem: true,
};
const asMultiset = (calls: unknown[]) => calls.map((c) => JSON.stringify(c)).sort();

describe('[#10757 leg 4] the Default Organization read and the activation ledger read are one wave', () => {
  it('⭐ the promoted administrator with no active organization: 2 legs, the same envelope, the same reads', async () => {
    const ql = makeRecordingQl(promotedAdmin('org_default', DEFAULT_ONLY));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' });

    expect(grants).toEqual({
      positions: ['platform_admin', 'org_owner', 'everyone'],
      permissions: [ADMIN_FULL_ACCESS],
      directPermissions: [ADMIN_FULL_ACCESS],
      systemPermissions: expect.any(Array),
      org_user_ids: ['usr_1'],
      accessible_org_ids: ['org_default'],
      email: 'admin@example.com',
      posture: 'PLATFORM_ADMIN',
      ...(grants.tabPermissions ? { tabPermissions: grants.tabPermissions } : {}),
    });
    expect(asMultiset(ql.calls)).toEqual(asMultiset([
      { object: 'sys_user', where: { id: 'usr_1' }, limit: 1, isSystem: true },
      { object: 'sys_member', where: { user_id: 'usr_1' }, limit: 200, isSystem: true },
      { object: 'sys_user_position', where: { user_id: 'usr_1' }, limit: 200, isSystem: true },
      { object: 'sys_user_permission_set', where: { user_id: 'usr_1' }, limit: 100, isSystem: true },
      DEFAULT_ORGANIZATION_READ,
      ledgerReadOf(['org_owner', 'everyone', ADMIN_FULL_ACCESS]),
    ]));
    // Was 3: wave 1, then the organization, then the ledger.
    expect(ql.legs).toBe(2);
    const second = ql.calls.filter((_, i) => ql.legOf[i] === 2).map((c) => c.object).sort();
    expect(second).toEqual(['sys_metadata_activation', 'sys_organization']);
  });

  it('the promoted administrator acting IN the Default Organization: 2 legs, the same envelope, the same reads', async () => {
    const ql = makeRecordingQl(promotedAdmin('org_default', DEFAULT_ONLY));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', {
      nowMs: NOW, tenantId: 'org_default', seedEmail: 'admin@example.com',
    });
    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(grants.positions).toEqual(['platform_admin', 'org_owner', 'everyone']);
    expect(grants.permissions).toEqual([ADMIN_FULL_ACCESS]);
    expect(grants.org_user_ids).toEqual(['usr_1']);
    expect(asMultiset(ql.calls)).toEqual(asMultiset([
      { object: 'sys_user', where: { id: 'usr_1' }, limit: 1, isSystem: true },
      { object: 'sys_member', where: { user_id: 'usr_1' }, limit: 200, isSystem: true },
      { object: 'sys_user_position', where: { user_id: 'usr_1' }, limit: 200, isSystem: true },
      { object: 'sys_member', where: { organization_id: 'org_default' }, limit: 1000, isSystem: true },
      { object: 'sys_user_permission_set', where: { user_id: 'usr_1' }, limit: 100, isSystem: true },
      DEFAULT_ORGANIZATION_READ,
      ledgerReadOf(['org_owner', 'everyone', ADMIN_FULL_ACCESS]),
    ]));
    expect(ql.legs).toBe(2);
  });

  it('a DEACTIVATED admin_full_access still confers nothing — the ledger verdict reaches the parallel anchor', async () => {
    const ql = makeRecordingQl({
      ...promotedAdmin('org_default', DEFAULT_ONLY),
      sys_metadata_activation: [{ metadata_type: 'permission', name: ADMIN_FULL_ACCESS, active: false }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' });
    expect(grants.posture).toBe('MEMBER');
    expect(grants.positions).not.toContain('platform_admin');
    expect(grants.permissions).not.toContain(ADMIN_FULL_ACCESS);
    expect(ql.legs).toBe(2);
  });

  it('⚠️ the one recorded widening: another organization\'s grant asks the ledger about its name, and still confers nothing', async () => {
    // The anchoring is open until the organization read answers, so the ledger
    // is asked about `admin_full_access` too. The sequential version did not
    // ask (the grant turned out not to apply). The answer is unchanged: the
    // grant applies neither in this tenant nor as the anchor, so neither the
    // set nor standing is conferred, and the ledger's verdict on the name is
    // read by nobody.
    const orgs = [{ id: 'org_default', slug: 'default' }, { id: 'org_b', slug: 'b' }];
    const ql = makeRecordingQl(promotedAdmin('org_b', orgs));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' });
    expect(grants.posture).toBe('MEMBER');
    expect(grants.permissions).toEqual([]);
    expect(grants.positions).toEqual(['org_owner', 'everyone']);
    expect(ql.calls.find((c) => c.object === 'sys_organization')).toEqual(DEFAULT_ORGANIZATION_READ);
    expect(ql.calls.find((c) => c.object === 'sys_metadata_activation')).toEqual(
      ledgerReadOf(['org_owner', 'everyone', ADMIN_FULL_ACCESS]),
    );
    expect(ql.legs).toBe(2);
  });

  it('a principal holding no organization-owned admin_full_access issues no organization read, as before', async () => {
    const ql = makeRecordingQl({
      ...promotedAdmin('org_default', DEFAULT_ONLY),
      sys_user_permission_set: [],
    });
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' });
    expect(grants.posture).toBe('MEMBER');
    expect(ql.calls.map((c) => c.object)).not.toContain('sys_organization');
    expect(ql.calls.find((c) => c.object === 'sys_metadata_activation')).toEqual(ledgerReadOf(['org_owner', 'everyone']));
    expect(ql.legs).toBe(2);
  });
});

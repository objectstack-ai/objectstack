// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 addendum D12 — sys_user.primary_business_unit_id projection.
 *
 * Proves the server-side capability D12 actually delivers: the denormalised
 * `primary_business_unit_id` column is maintained by plugin-sharing's hooks as
 * `sys_business_unit_member.is_primary` changes, which is what makes
 * "pick people by business unit" expressible as a plain
 * `where: { primary_business_unit_id: X }` query (and therefore as a
 * `lookupFilters` picker filter — that part is a client-side hint, so it is the
 * column + its maintenance, not lookupFilters enforcement, that we assert here).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } } as const;
const EMAIL = 'd12-primary-bu@verify.test';

describe('ADR-0057 D12: sys_user.primary_business_unit_id projection', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let uid: string;

  const sys = (o: string, d: any) => ql.insert(o, d, SYS);
  const findOne = async (o: string, where: any, fields: string[]) =>
    (await ql.find(o, { where, fields, limit: 1, context: { isSystem: true } }))?.[0];
  const primaryBuOf = async (id: string) =>
    (await findOne('sys_user', { id }, ['id', 'primary_business_unit_id']))?.primary_business_unit_id ?? null;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    await stack.signIn();
    await stack.signUp(EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');

    const org = await findOne('sys_organization', {}, ['id']);
    orgId = org?.id ?? 'org_d12';
    if (!org) await sys('sys_organization', { id: orgId, name: 'D12 Org', slug: 'd12' });

    await sys('sys_business_unit', { id: 'bu_d12_a', name: 'Unit A', kind: 'department', organization_id: orgId, active: true });
    await sys('sys_business_unit', { id: 'bu_d12_b', name: 'Unit B', kind: 'department', organization_id: orgId, active: true });

    uid = (await findOne('sys_user', { email: EMAIL }, ['id']))?.id;
    expect(uid, 'signed-up user resolves').toBeTruthy();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('sets primary_business_unit_id when a primary member is inserted', async () => {
    await sys('sys_business_unit_member', { id: 'mem_d12_a', user_id: uid, business_unit_id: 'bu_d12_a', is_primary: true });
    expect(await primaryBuOf(uid)).toBe('bu_d12_a');
  });

  it('makes "pick people by BU" expressible — sys_user filters by primary_business_unit_id', async () => {
    const inA = (await ql.find('sys_user', { where: { primary_business_unit_id: 'bu_d12_a' }, fields: ['id'], limit: 100, context: { isSystem: true } })).map((u: any) => u.id);
    const inB = (await ql.find('sys_user', { where: { primary_business_unit_id: 'bu_d12_b' }, fields: ['id'], limit: 100, context: { isSystem: true } })).map((u: any) => u.id);
    expect(inA).toContain(uid);
    expect(inB).not.toContain(uid);
  });

  it('follows the primary flag when it moves to another business unit', async () => {
    await ql.update('sys_business_unit_member', { id: 'mem_d12_a', is_primary: false }, SYS);
    await sys('sys_business_unit_member', { id: 'mem_d12_b', user_id: uid, business_unit_id: 'bu_d12_b', is_primary: true });
    expect(await primaryBuOf(uid)).toBe('bu_d12_b');
  });

  it('clears the projection when the primary member is deleted', async () => {
    await ql.delete('sys_business_unit_member', { where: { id: 'mem_d12_b' }, context: { isSystem: true } });
    expect(await primaryBuOf(uid)).toBeNull();
  });
});

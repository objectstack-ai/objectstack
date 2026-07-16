// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0086 D5 — stack-declared `permissions` are seeded into
// `sys_permission_set` at boot with package provenance
// (`managed_by:'package'` + `package_id`), closing the ADR-0078
// inert-metadata violation for this surface: the admin table finally sees a
// package's sets, and uninstall/upgrade have a well-defined owner axis.
// Proven on the real showcase stack, which declares `showcase_contributor`
// and `showcase_member_default` in `src/security/`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('showcase: declared permission-set seeding (ADR-0086 D5)', () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);
  afterAll(async () => { await stack?.stop(); });

  it('declared sets land in sys_permission_set with package provenance', async () => {
    const rows = await ql.find('sys_permission_set', { where: {} }, { context: { isSystem: true } });
    const contributor = (rows ?? []).find((r: any) => r.name === 'showcase_contributor');
    expect(contributor, 'declared set must be materialized as a record').toBeTruthy();
    expect(contributor.managed_by).toBe('package');
    expect(contributor.package_id).toBe('com.example.showcase');
    // the record carries the actual declared grants, not an empty husk
    const objectPerms = JSON.parse(contributor.object_permissions || '{}');
    expect(Object.keys(objectPerms).length).toBeGreaterThan(0);
  });

  it('platform defaults stay env-owned (no package provenance stamped)', async () => {
    const rows = await ql.find('sys_permission_set', { where: { name: 'member_default' } }, { context: { isSystem: true } });
    const memberDefault = (rows ?? [])[0];
    expect(memberDefault, 'bootstrapPlatformAdmin default exists').toBeTruthy();
    // bootstrapDeclaredPermissions must not adopt/clobber the insert-once default
    expect(memberDefault.managed_by ?? null).not.toBe('package');
  });

  it('seeding is idempotent (exactly one row per declared set)', async () => {
    const rows = await ql.find('sys_permission_set', { where: { name: 'showcase_contributor' } }, { context: { isSystem: true } });
    expect((rows ?? []).length).toBe(1);
  });
});

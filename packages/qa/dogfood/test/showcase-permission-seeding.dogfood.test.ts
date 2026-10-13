// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0131 D3 (C3 stage 6b-2) — stack-declared `permissions` are served by the
// security catalog from the registry, with their owning package, and the boot
// writes NO `sys_permission_set` row: not for a package's sets, not for the
// platform defaults. (ADR-0086 D5's boot seeding, which this file used to pin,
// retired with the declared-permission seeder.) Proven on the real showcase
// stack, which declares `showcase_contributor` and `showcase_member_default`
// in `src/security/`.
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: declarative-permission-seeding

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

describe('showcase: declared permission sets are served by the security catalog (ADR-0131 D3)', () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await bootShowcase();
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);
  afterAll(async () => { await stack?.stop(); });

  it('a declared set is served with its owning package and its declared grants', async () => {
    const contributor: any = await catalogPermissionSet(ql, 'showcase_contributor');
    expect(contributor, 'declared set served by the security catalog').toBeTruthy();
    expect(contributor._packageId).toBe('com.example.showcase');
    // the definition carries the actual declared grants, not an empty husk
    expect(Object.keys(contributor.objects ?? {}).length).toBeGreaterThan(0);
  });

  it('a platform default is served too, with no package of the app stamped on it', async () => {
    const memberDefault: any = await catalogPermissionSet(ql, 'member_default');
    expect(memberDefault, 'platform default served by the security catalog').toBeTruthy();
    expect(memberDefault._packageId ?? null).not.toBe('com.example.showcase');
  });

  it('the boot writes no sys_permission_set row — and the census can see one', async () => {
    const SYS = { context: { isSystem: true } };
    // The census runs where the row object is still registered. (C3 stage 8
    // retires the object, and there is then no table to hold a row at all.)
    if (ql.getObject?.('sys_permission_set')) {
      expect(await ql.find('sys_permission_set', { where: {} }, SYS)).toEqual([]);
      // Positive control: the same read sees a row once one exists.
      await ql.insert('sys_permission_set', { id: 'ps_census_control', name: 'zz_census_control', label: 'Control' }, SYS);
      expect(((await ql.find('sys_permission_set', { where: {} }, SYS)) ?? []).map((r: any) => r.name)).toEqual(['zz_census_control']);
      await ql.delete('sys_permission_set', { where: { id: 'ps_census_control' }, ...SYS });
    }
  });
});

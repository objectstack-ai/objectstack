// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0090 D5 ("no ghost grants") on the protocol's own uninstall door,
// `deletePackage` — after ADR-0131 C3 stage 6b-2, where no door writes a
// `sys_permission_set` row: a package's set is served by the security catalog
// from the registry, and a grant names it.
//
// The withdrawal (`registry.uninstallPackage`) runs before the uninstall
// cleanups and releases the package's names, so the door captures the
// permission-set names the package held just before it, and plugin-security's
// cleanup revokes the grants naming them. Without that hand-off the grant
// survives the uninstall, inert while nothing serves the name, and is live
// again the moment the package publishes the set again. The install-local door
// is pinned end to end by the CLI suite
// `package-install-local-uninstall-cleanups.integration.test.ts`.
//
// Real stack: the CRM example over the real SecurityPlugin; the package is a
// writable base that publishes its own set (ADR-0070), and the uninstall is
// `deletePackage` on it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true };
const BASE = 'app.dogfood_uninstall_grants';
const SET = 'dfu_task_user';
const USER = 'usr_dfu_grantee';

describe('dogfood: deletePackage revokes the grants naming the package\'s permission sets (ADR-0090 D5)', () => {
  let stack: VerifyStack;
  let protocol: any;
  let ql: any;

  const publishSet = () => protocol.saveMetaItem({
    type: 'permission',
    name: SET,
    item: { name: SET, label: 'DFU Task User', objects: { crm_lead: { allowRead: true } } },
    packageId: BASE,
    mode: 'publish',
  });
  const grants = async () =>
    ((await ql.find('sys_user_permission_set', { where: { permission_set: SET }, context: SYS })) ?? []) as any[];

  let granted: any;
  let uninstall: any;
  let afterUninstall: { served: unknown; grants: any[] };
  let afterRepublish: { served: unknown; grants: any[] };

  beforeAll(async () => {
    stack = await bootStack(crmStack);
    protocol = await stack.kernel.getServiceAsync<any>('protocol');
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    await ql.insert('sys_user', { id: USER, email: 'dfu@example.test', name: 'DFU', email_verified: true }, { context: SYS });
    await publishSet();
    granted = await ql.insert('sys_user_permission_set', { user_id: USER, permission_set: SET }, { context: SYS });

    uninstall = await protocol.deletePackage({ packageId: BASE });
    afterUninstall = { served: await catalogPermissionSet(ql, SET), grants: await grants() };

    // The same package publishes the same set again.
    await publishSet();
    afterRepublish = { served: await catalogPermissionSet(ql, SET), grants: await grants() };
  }, 120_000);
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('precondition: the package\'s set was served and the user held a grant naming it', () => {
    expect(granted?.id).toBeTruthy();
    expect(granted?.permission_set).toBe(SET);
  });

  it('the uninstall reports the security cleanup, and the grant is gone with the set', () => {
    const security = (uninstall?.cleanups ?? []).find((o: any) => o?.name === 'security.package-permissions');
    expect(security, JSON.stringify(uninstall)).toMatchObject({ success: true });
    expect(security.removed).toBeGreaterThanOrEqual(1);
    expect(afterUninstall.served).toBeUndefined();
    expect(afterUninstall.grants).toEqual([]);
  });

  it('the set published again is served again — and the revoked grant does not come back with it', () => {
    expect((afterRepublish.served as any)?.name).toBe(SET);
    expect(afterRepublish.grants).toEqual([]);
  });
});

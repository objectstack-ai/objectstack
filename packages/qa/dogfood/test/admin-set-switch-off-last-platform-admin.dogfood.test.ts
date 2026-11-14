// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #33082 — switching `admin_full_access` off through the catalog activation
// door, on the stock `single` showcase, over HTTP.
//
// The seeded admin is the only `admin_full_access` holder and also the Default
// Organization's owner. Before #33082 the last-admin guard counted that
// ownership as a remaining administrator, let the switch-off land, and the
// deployment was stuck: the only door that switches the set back on asks for
// `manage_metadata`, which `organization_admin_no_bypass` does not carry. The
// ledger halves of the guard now also judge the PLATFORM-admin population
// (`refuseIfPlatformStandingEnds`, `last-admin-guard.ts`):
//
//   - no configured platform owner → the switch-off is refused 403, and the
//     admin keeps `admin_full_access` and `manage_metadata`;
//   - a configured, verified platform owner (`OS_PLATFORM_OWNER_EMAIL`) → the
//     switch-off lands, and that owner, who keeps `manage_metadata` through the
//     config anchor, switches the set back on through the same door, and the
//     seeded admin's set is in effect again.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VerifyStack } from '@objectstack/verify';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { bootShowcase } from './showcase-boot.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
const SYS = { isSystem: true } as const;
const OWNER = 'switch-off-owner@verify.test';
const OWNER_PASSWORD = 'switch-off-owner-Passw0rd!';
const DOOR = '/security/_activation/permission/admin_full_access';

interface Perms { permissionSets: string[]; systemPermissions: string[] }

async function permsOf(stack: VerifyStack, token: string): Promise<Perms> {
  const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
  expect(res.status, 'me/permissions answers').toBe(200);
  const body = (await res.json()) as any;
  const p = body?.data ?? body;
  return {
    permissionSets: (p?.permissionSets ?? []) as string[],
    systemPermissions: (p?.systemPermissions ?? []) as string[],
  };
}

async function flip(stack: VerifyStack, token: string, enabled: boolean): Promise<{ status: number; code: unknown; message: string }> {
  const res = await stack.apiAs(token, 'POST', DOOR, { enabled });
  const body = (await res.json().catch(() => ({}))) as any;
  return {
    status: res.status,
    code: body?.error?.code ?? body?.code ?? null,
    message: String(body?.error?.message ?? body?.message ?? ''),
  };
}

describe('#33082 — the last platform admin cannot switch admin_full_access off; a configured owner can switch it back on', () => {
  const previous = process.env[ENV];
  let dir: string;
  let stack: VerifyStack | undefined;
  let ql: any;

  const restart = async (value: string | undefined): Promise<VerifyStack> => {
    await stack?.stop();
    stack = undefined;
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    resetPlatformAdminEmailMemo();
    stack = await bootShowcase({ databaseFile: join(dir, 'admin-set-switch-off.db') });
    ql = await stack.kernel.getServiceAsync('objectql');
    return stack;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-admin-set-switch-off-'));
  });

  afterAll(async () => {
    await stack?.stop();
    if (previous === undefined) delete process.env[ENV];
    else process.env[ENV] = previous;
    resetPlatformAdminEmailMemo();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('no configured owner: the switch-off is refused 403 and the admin keeps the set', async () => {
    const s = await restart(undefined);
    const admin = await s.signIn();
    const before = await permsOf(s, admin);
    expect(before.permissionSets, 'the seeded admin holds the set').toContain('admin_full_access');
    expect(before.systemPermissions).toContain('manage_metadata');

    const off = await flip(s, admin, false);
    expect({ status: off.status, code: off.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(off.message).toContain('last platform administrator');

    const after = await permsOf(s, admin);
    expect(after.permissionSets, 'the set is still in effect').toContain('admin_full_access');
    expect(after.systemPermissions).toContain('manage_metadata');
    const ledger = await ql.find('sys_metadata_activation', {
      where: { metadata_type: 'permission', name: 'admin_full_access' }, context: SYS,
    });
    expect(ledger.filter((r: any) => r.active === false || r.active === 0), 'no switched-off row was written').toEqual([]);
  }, 180_000);

  it('a configured, verified owner: the switch-off lands, and the owner switches it back on through the same door', async () => {
    // Sign the owner up on the unset deployment, verify the address, then
    // restart with the variable naming it (the config anchor reads at boot).
    let s = await restart(undefined);
    await s.signUp(OWNER, OWNER_PASSWORD);
    const row = await ql.findOne('sys_user', { where: { email: OWNER }, context: SYS });
    await ql.update('sys_user', { id: row.id, email_verified: true }, { context: SYS });

    s = await restart(OWNER);
    const admin = await s.signIn();
    const owner = await s.signIn(OWNER, OWNER_PASSWORD);
    expect((await permsOf(s, owner)).systemPermissions, 'the owner holds manage_metadata through the config anchor')
      .toContain('manage_metadata');

    const off = await flip(s, admin, false);
    expect(off.status, `switch-off lands: ${off.message}`).toBe(200);
    expect((await permsOf(s, admin)).permissionSets, 'the seeded admin\'s set is off').not.toContain('admin_full_access');
    expect((await permsOf(s, owner)).systemPermissions, 'the owner still holds manage_metadata').toContain('manage_metadata');

    const on = await flip(s, owner, true);
    expect(on.status, `switch-on lands: ${on.message}`).toBe(200);
    expect((await permsOf(s, admin)).permissionSets, 'the seeded admin\'s set is in effect again').toContain('admin_full_access');
  }, 240_000);
});

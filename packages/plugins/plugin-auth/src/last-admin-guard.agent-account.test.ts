// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D2/D3] An AI service account is never counted as an
 * administrator by the break-glass guard, whatever its grade or its grants
 * say.
 *
 * An account (a `sys_user` row of kind `agent`) holds no administrator
 * standing — the resolver withholds every administrator set from it — and it
 * can never sign in, so it is no escape hatch. A guard that counted it would
 * wave through the write that ends the last person's standing. Only a system
 * or seed writer can store an administrator grant on an account (a non-system
 * write is refused at assignment), and an organization administrator can
 * raise its membership grade; these rows are those writes.
 *
 * Same method as `last-admin-guard.default-organization.test.ts`: a REAL
 * ObjectQL engine over better-sqlite3 `:memory:`, so the engine dispatches the
 * hooks. Each pin sits beside a CONTROL where a person holds the same thing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import {
  registerLastAdminGuard, resolveAdminUserIds, type LastAdminGuardEngine,
} from './last-admin-guard.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const SYSTEM = { context: { isSystem: true } } as const;

const text = (name: string) => ({ name, type: 'text' as const });
const OBJECTS = [
  {
    name: 'sys_user',
    label: 'User',
    managedBy: 'better-auth',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      email: text('email'),
      email_verified: { name: 'email_verified', type: 'boolean' as const },
      banned: { name: 'banned', type: 'boolean' as const, readonly: true },
      principal_kind: text('principal_kind'),
      accountable_user_id: text('accountable_user_id'),
    },
  },
  {
    name: 'sys_member',
    label: 'Member',
    managedBy: 'better-auth',
    fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') },
  },
  {
    name: 'sys_organization',
    label: 'Organization',
    managedBy: 'better-auth',
    fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), slug: text('slug') },
  },
  {
    name: 'sys_user_permission_set',
    label: 'User Permission Set',
    fields: {
      id: { ...text('id'), primaryKey: true },
      user_id: text('user_id'),
      permission_set: text('permission_set'),
      organization_id: text('organization_id'),
      valid_from: { name: 'valid_from', type: 'datetime' as const },
      valid_until: { name: 'valid_until', type: 'datetime' as const },
    },
  },
];

let engines: ObjectQL[] = [];
const ambient: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of [POSTURE_ENV, MULTI_ORG_ENV, OWNER_ENV]) {
    ambient[name] = process.env[name];
    delete process.env[name];
  }
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetPlatformAdminEmailMemo();
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

/**
 * A `single` environment whose one person administrator, `usr_admin`, holds
 * the Default Organization's `admin_full_access` grant, beside an AI service
 * account, `usr_bot`, that holds the same grant AND an owner membership of
 * that organization. With `person`, a second person holds `as` too.
 */
async function environment(opts: { person?: 'grant' | 'owner' } = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard.agent-account' });

  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYSTEM);
  for (const id of ['usr_admin', 'usr_person']) {
    await engine.insert('sys_user', {
      id, name: id, email: `${id}@d.example`, email_verified: true, banned: false, principal_kind: 'human',
    }, SYSTEM);
  }
  await engine.insert('sys_user', {
    id: 'usr_bot', name: 'Bot', email: 'bot@placeholder.invalid', email_verified: false, banned: false,
    principal_kind: 'agent', accountable_user_id: 'usr_admin',
  }, SYSTEM);

  await engine.insert('sys_user_permission_set', {
    id: 'ups_admin', user_id: 'usr_admin', permission_set: ADMIN_FULL_ACCESS, organization_id: 'org_default',
  }, SYSTEM);
  await engine.insert('sys_user_permission_set', {
    id: 'ups_bot', user_id: 'usr_bot', permission_set: ADMIN_FULL_ACCESS, organization_id: 'org_default',
  }, SYSTEM);
  await engine.insert('sys_member', { id: 'm_bot', user_id: 'usr_bot', organization_id: 'org_default', role: 'owner' }, SYSTEM);

  if (opts.person === 'grant') {
    await engine.insert('sys_user_permission_set', {
      id: 'ups_person', user_id: 'usr_person', permission_set: ADMIN_FULL_ACCESS, organization_id: 'org_default',
    }, SYSTEM);
  }
  if (opts.person === 'owner') {
    await engine.insert('sys_member', { id: 'm_person', user_id: 'usr_person', organization_id: 'org_default', role: 'owner' }, SYSTEM);
  }
  return engine;
}

const ban = (engine: ObjectQL, id: string) => engine.update('sys_user', { id, banned: true }, SYSTEM);
const refusal = { code: 'PERMISSION_DENIED', status: 403 };

describe('[ADR-0151 D2/D3] the break-glass guard never counts an AI service account as an administrator', () => {
  it('the enumeration names the person and never the account, for either population', async () => {
    const engine = await environment();
    const readable = engine as unknown as LastAdminGuardEngine;
    expect([...(await resolveAdminUserIds(readable))]).toEqual(['usr_admin']);
    expect([...(await resolveAdminUserIds(readable, { standing: 'platform-admins' }))]).toEqual(['usr_admin']);
  });

  it('banning the last person administrator is refused, although an account holds the same grant and an owner grade', async () => {
    const engine = await environment();
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });

  it('revoking the last person administrator\'s grant is refused, although an account holds the same grant', async () => {
    const engine = await environment();
    await expect(engine.delete('sys_user_permission_set', { where: { id: 'ups_admin' }, ...SYSTEM }))
      .rejects.toMatchObject(refusal);
  });

  it('CONTROL: a person holding the same grant is counted, so the ban is admitted', async () => {
    const engine = await environment({ person: 'grant' });
    await expect(ban(engine, 'usr_admin')).resolves.toBeDefined();
  });

  it('CONTROL: a person holding the same owner grade is counted, so the ban is admitted', async () => {
    const engine = await environment({ person: 'owner' });
    await expect(ban(engine, 'usr_admin')).resolves.toBeDefined();
  });

  it('CONTROL: banning the account itself is admitted, since it was never one of the administrators', async () => {
    const engine = await environment();
    await expect(ban(engine, 'usr_bot')).resolves.toBeDefined();
  });
});

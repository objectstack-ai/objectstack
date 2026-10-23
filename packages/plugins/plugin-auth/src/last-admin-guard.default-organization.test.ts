// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D5] Under `single` the first-user promotion's `admin_full_access`
 * grant is OWNED BY THE DEFAULT ORGANIZATION, and `resolveAuthzContext` reads
 * that row as the anchor of platform standing (`grantAnchorsPlatformStanding`).
 * The break-glass guard answers the same question, so two things hold here:
 *
 *  1. **The enumeration counts that grant's holder.** An enumeration reading
 *     only the organization-less row would see an environment with no
 *     administrator and wave through the ban, the revocation or the re-scoping
 *     that ends the last one.
 *  2. **The guard judges the organization writes that move the anchor.** The
 *     Default Organization is the one with `slug = 'default'`, else the only
 *     one — so re-slugging it while another organization exists, deleting it,
 *     or creating a second organization beside a sole one not slugged
 *     `default`, takes the standing away with no grant row touched.
 *
 * Same method as `last-admin-guard.config-anchor.test.ts`: a REAL ObjectQL
 * engine over better-sqlite3 `:memory:`, so the engine dispatches the hooks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import { registerLastAdminGuard, type LastAdminGuardEngine, type LastAdminGuardHandle } from './last-admin-guard.js';
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
/** The handle the most recent `promotedSingle` registered. */
let guard: LastAdminGuardHandle;
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
 * A `single` environment whose sole administrator holds the grant the promotion
 * writes — owned by the Default Organization — and nothing else (no
 * membership, so the organization-owner half of the enumeration counts nobody).
 */
async function promotedSingle(
  opts: { secondOrganization?: boolean; grantOwner?: string; defaultSlug?: string } = {},
): Promise<ObjectQL> {
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
  guard = registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard.default-org' });

  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: opts.defaultSlug ?? 'default' }, SYSTEM);
  if (opts.secondOrganization) {
    await engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM);
  }
  for (const id of ['usr_admin', 'usr_other']) {
    await engine.insert('sys_user', { id, name: id, email: `${id}@d.example`, email_verified: true, banned: false }, SYSTEM);
  }
  await engine.insert('sys_user_permission_set', {
    id: 'ups_admin', user_id: 'usr_admin', permission_set: ADMIN_FULL_ACCESS, organization_id: opts.grantOwner ?? 'org_default',
  }, SYSTEM);
  return engine;
}

const ban = (engine: ObjectQL, id: string) => engine.update('sys_user', { id, banned: true }, SYSTEM);
const refusal = { code: 'PERMISSION_DENIED', status: 403 };

describe('[ADR-0131 D5] the enumeration counts the holder of the Default Organization\'s grant', () => {
  it('banning that sole administrator is refused', async () => {
    const engine = await promotedSingle();
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });

  it('revoking the grant, or re-scoping it to another organization, is refused', async () => {
    const engine = await promotedSingle({ secondOrganization: true });
    await expect(engine.delete('sys_user_permission_set', { where: { id: 'ups_admin' }, ...SYSTEM } as any))
      .rejects.toMatchObject(refusal);
    await expect(engine.update('sys_user_permission_set', { id: 'ups_admin', organization_id: 'org_b' }, SYSTEM))
      .rejects.toMatchObject(refusal);
  });

  it('CONTROL — another organization\'s grant of the set makes no administrator: banning its holder is permitted', async () => {
    const engine = await promotedSingle({ secondOrganization: true, grantOwner: 'org_b' });
    await expect(ban(engine, 'usr_admin')).resolves.toBeDefined();
  });
});

describe('[ADR-0131 D5] the organization writes that move the anchor off that grant are judged', () => {
  it('re-slugging the Default Organization while another organization exists is refused', async () => {
    const engine = await promotedSingle({ secondOrganization: true });
    await expect(engine.update('sys_organization', { id: 'org_default', slug: 'renamed' }, SYSTEM))
      .rejects.toMatchObject(refusal);
  });

  it('deleting the Default Organization is refused', async () => {
    const engine = await promotedSingle();
    await expect(engine.delete('sys_organization', { where: { id: 'org_default' }, ...SYSTEM } as any))
      .rejects.toMatchObject(refusal);
  });

  it('CONTROL — a sole organization stays the Default Organization whatever its slug, and a name change is no standing write', async () => {
    const engine = await promotedSingle();
    await expect(engine.update('sys_organization', { id: 'org_default', slug: 'acme' }, SYSTEM)).resolves.toBeDefined();
    await expect(engine.update('sys_organization', { id: 'org_default', name: 'Acme Inc' }, SYSTEM)).resolves.toBeDefined();
    // …and the administrator is still counted afterwards.
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });
});

describe('[ADR-0131 D5] creating an organization that moves the anchor off that grant is judged', () => {
  // A sole organization is the Default Organization whatever its slug, so the
  // fixture's `acme` organization owns the anchoring grant until a second
  // organization arrives: then none is the Default Organization (the second
  // one has another slug), or the second one is (it is slugged `default`).
  const organizationIds = async (engine: ObjectQL) =>
    ((await engine.find('sys_organization', { where: {}, ...SYSTEM })) as Array<Record<string, unknown>>)
      .map((row) => row.id)
      .sort();

  it('a second organization beside a sole one not slugged `default` is refused, and nothing is written', async () => {
    const engine = await promotedSingle({ defaultSlug: 'acme' });
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM))
      .rejects.toMatchObject({ ...refusal, object: 'sys_organization' });
    expect(await organizationIds(engine)).toEqual(['org_default']);
    // The grant still anchors: its holder is still the last administrator.
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });

  it('a new organization slugged `default` beside a sole one with another slug is refused', async () => {
    const engine = await promotedSingle({ defaultSlug: 'acme' });
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'default' }, SYSTEM))
      .rejects.toMatchObject({ ...refusal, object: 'sys_organization' });
    expect(await organizationIds(engine)).toEqual(['org_default']);
  });

  it('the refusal names the remedy that keeps the anchor: slug the current one `default` first, then the insert is admitted', async () => {
    const engine = await promotedSingle({ defaultSlug: 'acme' });
    const err = await engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM)
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err?.message).toContain('organization creation');
    await expect(engine.update('sys_organization', { id: 'org_default', slug: 'default' }, SYSTEM)).resolves.toBeDefined();
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM)).resolves.toBeDefined();
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });

  it('CONTROL — a `default`-slugged Default Organization stays put, so a second organization is admitted', async () => {
    const engine = await promotedSingle();
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM)).resolves.toBeDefined();
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal);
  });

  it('CONTROL — an administrator left standing elsewhere admits the insert: the guard is break-glass, not standing preservation', async () => {
    const engine = await promotedSingle({ defaultSlug: 'acme' });
    await engine.insert('sys_member', { id: 'mem_owner', user_id: 'usr_admin', organization_id: 'org_default', role: 'owner' }, SYSTEM);
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM)).resolves.toBeDefined();
  });

  it('CONTROL — under a wall no grant anchors, so the insert is admitted without a read', async () => {
    const engine = await promotedSingle({ defaultSlug: 'acme' });
    process.env[POSTURE_ENV] = 'isolated';
    const reads: string[] = [];
    const find = engine.find.bind(engine);
    (engine as unknown as { find: typeof engine.find }).find = ((object: string, ...rest: unknown[]) => {
      reads.push(object);
      return (find as (...a: unknown[]) => unknown)(object, ...rest);
    }) as typeof engine.find;
    await expect(engine.insert('sys_organization', { id: 'org_b', name: 'B', slug: 'b' }, SYSTEM)).resolves.toBeDefined();
    expect(reads).toEqual([]);
  });
});

describe('[#24948] the same question about deleting the Default Organization, asked before anything is deleted', () => {
  const members = (engine: ObjectQL) =>
    engine.find('sys_member', { where: {}, ...SYSTEM }) as Promise<Array<Record<string, unknown>>>;

  it('refuses when the grant the Default Organization owns is the last standing', async () => {
    await promotedSingle();
    await expect(guard.judgeOrganizationDelete('org_default')).rejects.toMatchObject(refusal);
  });

  it('judges the members that leave with the organization: an owner membership of it is no standing that survives', async () => {
    // The administrator's only standing is owning the Default Organization
    // (the grant belongs to another organization and anchors nothing). Asked
    // before better-auth deletes the members, a question that simulated only
    // the organization row would still count that membership and admit. A
    // third organization keeps org_b from becoming the only one, which would
    // make it the Default Organization and its grant an anchor.
    const engine = await promotedSingle({ secondOrganization: true, grantOwner: 'org_b' });
    await engine.insert('sys_organization', { id: 'org_c', name: 'C', slug: 'c' }, SYSTEM);
    await engine.insert('sys_member', { id: 'mem_owner', user_id: 'usr_admin', organization_id: 'org_default', role: 'owner' }, SYSTEM);
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject(refusal); // PREMISE: the membership is standing

    await expect(guard.judgeOrganizationDelete('org_default')).rejects.toMatchObject(refusal);
    // A question, not a write: the membership is still there.
    expect((await members(engine)).map((m) => m.id)).toEqual(['mem_owner']);
  });

  it('a read the question cannot complete refuses with the read-fault code, once: an inner envelope\'s answer passes the outer one unchanged', async () => {
    const engine = await promotedSingle();
    const real = engine.find.bind(engine);
    vi.spyOn(engine, 'find').mockImplementation(async (object: string, ...rest: any[]) => {
      if (object === 'sys_user_permission_set') throw new Error('sys_user_permission_set is unreadable');
      return (real as any)(object, ...rest);
    });

    const err = (await guard.judgeOrganizationDelete('org_default').catch((e: unknown) => e)) as Error & { code?: unknown; status?: unknown };
    vi.restoreAllMocks();
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(err.message.match(/SERVICE_UNAVAILABLE:/g)).toHaveLength(1);
    expect(err.message).toContain('sys_user_permission_set is unreadable');
  });

  it('CONTROL: with another administrator standing elsewhere, the delete is admitted', async () => {
    const engine = await promotedSingle({ secondOrganization: true, grantOwner: 'org_b' });
    await engine.insert('sys_organization', { id: 'org_c', name: 'C', slug: 'c' }, SYSTEM);
    await engine.insert('sys_member', { id: 'mem_owner', user_id: 'usr_admin', organization_id: 'org_default', role: 'owner' }, SYSTEM);
    await engine.insert('sys_member', { id: 'mem_other', user_id: 'usr_other', organization_id: 'org_b', role: 'owner' }, SYSTEM);

    await expect(guard.judgeOrganizationDelete('org_default')).resolves.toBeUndefined();
  });
});

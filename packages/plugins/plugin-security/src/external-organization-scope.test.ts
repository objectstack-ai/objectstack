// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under a walled tenancy posture every external object states its organization
 * scope (ADR-0015 §10) — the one predicate, the boot refusal, and the Layer 0
 * verdict a SecurityPlugin reaches through them.
 */

import { describe, it, expect, vi } from 'vitest';
import { TENANT_SCOPE_FIELD_DEF, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import {
  ExternalObjectOrganizationScopeUndeclaredError,
  externalOrganizationScopeOf,
  externalOrganizationScopeIsUndeclared,
  refuseUndeclaredExternalObjectScope,
  undeclaredExternalObjectsOf,
} from './external-organization-scope.js';

const REMOTE_COLUMNS = { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } };

/** The registry's view of an external object the author left silent: the remote columns plus the injected anchor. */
const undeclared = (extra: Record<string, unknown> = {}) => ({
  name: 'ext_customer',
  external: { remoteName: 'customers' },
  fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS },
  ...extra,
});

describe('externalOrganizationScopeOf — the one reading of the declaration', () => {
  it('a local object is not asked: `null`', () => {
    expect(externalOrganizationScopeOf({ name: 'task', fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF } } })).toBeNull();
  });

  it('an external object carrying only the injected anchor states nothing', () => {
    expect(externalOrganizationScopeOf(undeclared())).toBe('undeclared');
    expect(externalOrganizationScopeIsUndeclared(undeclared())).toBe(true);
  });

  it('an external object with no `organization_id` at all states nothing either', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, fields: REMOTE_COLUMNS })).toBe('undeclared');
  });

  it("the author's own `organization_id` field walls the object", () => {
    const schema = { name: 'ext', external: { remoteName: 'x' }, fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS } };
    expect(externalOrganizationScopeOf(schema)).toBe('walled');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(false);
  });

  it('the array `fields` shape reaches the same verdicts', () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' },
      fields: [{ name: 'organization_id', ...TENANT_SCOPE_FIELD_DEF }, { name: 'name', type: 'text' }],
    })).toBe('undeclared');
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' },
      fields: [{ name: 'organization_id', type: 'text', label: 'Org' }, { name: 'name', type: 'text' }],
    })).toBe('walled');
  });

  it('`tenancy: { enabled: false }` declares the object shared', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS })).toBe('shared');
  });

  it('`systemFields.tenant: false` declares the object shared', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, systemFields: { tenant: false }, fields: REMOTE_COLUMNS })).toBe('shared');
  });

  it("the whole-block `systemFields: false` is not one of the wall's opt-out clauses: alone it states nothing", () => {
    // The registry's recorded reading: the wall's `tenancyDisabled` has exactly
    // two clauses, and `systemFields: false` is in neither.
    const schema = { name: 'ext', external: { remoteName: 'x' }, systemFields: false, fields: REMOTE_COLUMNS };
    expect(externalOrganizationScopeOf(schema)).toBe('undeclared');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(true);
  });

  it('an object with its own `organization_id` beside `systemFields: false` is walled — never answered shared', () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, systemFields: false,
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('walled');
  });

  it("an opt-out clause beside an own `organization_id` is shared, as the wall reads it (it composes nothing on an opted-out object)", () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: false },
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('shared');
  });

  it('`tenancy.tenantField` naming another column is a declaration the wall cannot enforce', () => {
    const schema = {
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: true, tenantField: 'remote_org' },
      fields: { remote_org: { type: 'text', label: 'Remote org' }, organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS },
    };
    expect(externalOrganizationScopeOf(schema)).toBe('tenant-field-unenforceable');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(true);
  });

  it("`tenancy.tenantField: 'organization_id'` beside a declared `organization_id` is the walled declaration", () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: true, tenantField: 'organization_id' },
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('walled');
  });

  it('`tenancy: { enabled: true }` alone declares nothing', () => {
    expect(externalOrganizationScopeOf(undeclared({ tenancy: { enabled: true } }))).toBe('undeclared');
  });
});

describe('refuseUndeclaredExternalObjectScope — the boot refusal', () => {
  const objects = [
    { name: 'local_task', fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS } },
    undeclared({ name: 'ext_b' }),
    undeclared({ name: 'ext_a' }),
    { name: 'ext_shared', external: { remoteName: 's' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS },
    { name: 'ext_walled', external: { remoteName: 'w' }, fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS } },
    {
      name: 'ext_foreign', external: { remoteName: 'f' }, tenancy: { enabled: true, tenantField: 'remote_org' },
      fields: { remote_org: { type: 'text', label: 'R' }, organization_id: { ...TENANT_SCOPE_FIELD_DEF } },
    },
    // The whole-block opt-out is not a declaration: refused with the others.
    { name: 'ext_sf_false', external: { remoteName: 'sf' }, systemFields: false, fields: REMOTE_COLUMNS },
  ];

  it('names every undeclared external object, sorted, and only those', () => {
    expect(undeclaredExternalObjectsOf(objects)).toEqual([
      { object: 'ext_a', scope: 'undeclared' },
      { object: 'ext_b', scope: 'undeclared' },
      { object: 'ext_foreign', scope: 'tenant-field-unenforceable', tenantField: 'remote_org' },
      { object: 'ext_sf_false', scope: 'undeclared' },
    ]);
  });

  it.each(['isolated', 'group'] as const)('under `%s` the refusal names the objects and the three ways out', (posture) => {
    let thrown: unknown;
    try {
      refuseUndeclaredExternalObjectScope(posture, objects);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ExternalObjectOrganizationScopeUndeclaredError);
    const error = thrown as ExternalObjectOrganizationScopeUndeclaredError;
    expect(error.name).toBe('ExternalObjectOrganizationScopeUndeclaredError');
    expect(error.posture).toBe(posture);
    expect(error.objects.map((o) => o.object)).toEqual(['ext_a', 'ext_b', 'ext_foreign', 'ext_sf_false']);
    expect(error.message).toContain(`'${posture}' tenancy posture every external object states its organization scope`);
    expect(error.message).toContain("'ext_a', 'ext_b', 'ext_sf_false'");
    expect(error.message).toContain('`organization_id` field of its own');
    expect(error.message).toContain('`tenancy: { enabled: false }`');
    expect(error.message).toContain('`systemFields: { tenant: false }`');
    expect(error.message).toContain("'ext_foreign' declares `tenancy.tenantField: 'remote_org'`");
    expect(error.message).toContain("`external.columnMap: { remote_org: 'organization_id' }`");
    expect(error.message).not.toContain('ext_shared');
    expect(error.message).not.toContain('ext_walled');
    expect(error.message).not.toContain('local_task');
  });

  it('CONTROL: under `single` nothing is refused', () => {
    expect(() => refuseUndeclaredExternalObjectScope('single', objects)).not.toThrow();
  });

  it('CONTROL: a registry whose every external object declares its scope boots', () => {
    expect(() => refuseUndeclaredExternalObjectScope('isolated', objects.filter((o) => !/^ext_(a|b|foreign|sf_false)$/.test(o.name)))).not.toThrow();
  });
});

// ── Through the plugin: the boot door and the Layer 0 door ─────────────────

const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const MEMBER_CTX = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

/**
 * Boot a SecurityPlugin over a fake ObjectQL whose registry lists `objects` and
 * whose `getSchema` serves them by name. `hook` records the plugin's
 * `kernel:ready` handlers so a case can run the boot gate itself.
 */
async function bootWith(objects: Array<Record<string, unknown>>, opts: { posture?: string; hook?: boolean } = {}) {
  // The identity objects the plugin's OTHER `kernel:ready` gate asks for, so running
  // every recorded handler judges only the declaration under test.
  const identity = [{ name: 'sys_user', fields: {} }, { name: 'sys_member', fields: {} }];
  const byName = new Map([...identity, ...objects].map((o) => [o.name as string, o]));
  const ready: Array<() => unknown> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: vi.fn(),
      getSchema: (name: string) => byName.get(name),
      // The double answers no row, but refuses what the real engine refuses
      // (`check:engine-double-contract`).
      findOne: vi.fn(async (object: string, query?: Parameters<typeof assertEngineFindOnePredicate>[1]) => {
        assertEngineFindOnePredicate(object, query);
        return null;
      }),
      registry: { getAllObjects: () => [...byName.values()] },
    },
    metadata: { get: async (_t: string, name: string) => byName.get(name), list: async () => [PLAIN_MEMBER] },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
  };
  if (opts.posture) services['tenancy'] = { posture: opts.posture };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx: Record<string, unknown> = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    ...(opts.hook === false ? {} : { hook: (name: string, fn: () => unknown) => { if (name === 'kernel:ready') ready.push(fn); } }),
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  return { plugin, ready, logger };
}

describe('SecurityPlugin — the boot door', () => {
  it('a walled boot holding an undeclared external object is refused at `kernel:ready`, by name', async () => {
    const { ready } = await bootWith([undeclared()]);
    expect(ready.length).toBeGreaterThan(0);
    let thrown: unknown;
    for (const fn of ready) {
      try { await fn(); } catch (e) { thrown = e; }
    }
    expect(thrown).toBeInstanceOf(ExternalObjectOrganizationScopeUndeclaredError);
    expect((thrown as Error).message).toContain("'ext_customer'");
  });

  it('a walled boot whose external objects declare their scope completes', async () => {
    const { ready } = await bootWith([
      { name: 'ext_shared', external: { remoteName: 's' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS },
      { name: 'ext_walled', external: { remoteName: 'w' }, fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS } },
    ]);
    for (const fn of ready) await fn();
  });

  it('CONTROL: a `single` boot holding an undeclared external object completes', async () => {
    const { ready } = await bootWith([undeclared()], { posture: 'single' });
    for (const fn of ready) await fn();
  });

  it('a context without `kernel:ready` hooks (a declarations-only composition) judges at the end of `start()`', async () => {
    await expect(bootWith([undeclared()], { hook: false })).rejects.toBeInstanceOf(ExternalObjectOrganizationScopeUndeclaredError);
  });
});

describe('SecurityPlugin — the Layer 0 door, for an external object registered after the boot', () => {
  it('under `isolated` an undeclared external object is denied: the read filter is the deny sentinel', async () => {
    // The registry is empty at boot (nothing to refuse); the object appears at its first read.
    const { plugin, logger } = await bootWith([]);
    const schema = undeclared();
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    const filter = await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    expect(filter).toBe(RLS_DENY_FILTER);
    // Said once, naming the rule and the three ways out.
    const said = logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("'ext_customer' states none"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('every external object states its organization scope');
    expect(said[0]).toContain('`tenancy: { enabled: false }`');
    await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    expect(logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("'ext_customer' states none"))).toHaveLength(1);
  });

  it('under `group` the same object is denied', async () => {
    const { plugin } = await bootWith([], { posture: 'group' });
    const schema = undeclared();
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    const filter = await (plugin as any).getReadFilter('ext_customer', { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] });
    expect(filter).toBe(RLS_DENY_FILTER);
  });

  it('`tenancy.tenantField` naming another column is denied the same way', async () => {
    const { plugin } = await bootWith([]);
    const schema = undeclared({ tenancy: { enabled: true, tenantField: 'remote_org' } });
    (schema.fields as Record<string, unknown>).remote_org = { type: 'text', label: 'R' };
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    expect(await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX)).toBe(RLS_DENY_FILTER);
  });

  it('a declared `tenancy: { enabled: false }` object contributes nothing — shared by every organization', async () => {
    const { plugin } = await bootWith([]);
    const schema = { name: 'ext_customer', external: { remoteName: 'customers' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS };
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    expect(await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX)).toBeUndefined();
  });

  it("a declared `organization_id` keeps the wall: the caller's organization", async () => {
    const { plugin } = await bootWith([]);
    const schema = { name: 'ext_customer', external: { remoteName: 'customers' }, fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS } };
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    expect(await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX)).toEqual({ organization_id: 'org-1' });
  });

  it('CONTROL: under `single` the undeclared object is read as before, with no warning', async () => {
    const { plugin, logger } = await bootWith([], { posture: 'single' });
    const schema = undeclared();
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    expect(await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX)).toBeUndefined();
    expect(logger.warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('states none'))).toBe(false);
  });

  it('CONTROL: a local object carrying the injected anchor stays walled', async () => {
    const { plugin } = await bootWith([]);
    const schema = { name: 'task', fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS } };
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    expect(await (plugin as any).getReadFilter('task', MEMBER_CTX)).toEqual({ organization_id: 'org-1' });
  });
});

describe('SecurityPlugin — the write wall, for an external object registered after the boot', () => {
  const insertVerdict = async (schema: Record<string, unknown>, ctx: Record<string, unknown>, posture?: string) => {
    const { plugin } = await bootWith([], posture ? { posture } : {});
    (plugin as any).ql.getSchema = () => schema;
    (plugin as any).metadata.get = async () => schema;
    const verdicts = await (plugin as any).writeWallVerdict(schema.name, 'insert', ctx, [{ name: 'Nobody’s row' }]);
    return verdicts?.[0];
  };

  it('an insert naming no organization, by a caller WITH an active organization, is refused — naming the undeclared scope and the three ways out', async () => {
    const verdict = await insertVerdict(undeclared(), MEMBER_CTX);
    expect(verdict?.admitted).toBe(false);
    expect(verdict?.code).toBe('PERMISSION_DENIED');
    expect(verdict?.message).toContain("every external object states its organization scope, and 'ext_customer' states none");
    expect(verdict?.message).toContain('`organization_id` field of its own');
    expect(verdict?.message).toContain('`tenancy: { enabled: false }`');
    expect(verdict?.message).toContain('`systemFields: { tenant: false }`');
    // A caller who has an organization is not told to join one.
    expect(verdict?.message).not.toContain('active organization');
  });

  it('a caller WITHOUT an active organization meets the same sentence: the object, not the session, is what is missing', async () => {
    const verdict = await insertVerdict(undeclared(), { ...MEMBER_CTX, tenantId: undefined });
    expect(verdict?.admitted).toBe(false);
    expect(verdict?.message).toContain("'ext_customer' states none");
    expect(verdict?.message).not.toContain('active organization');
  });

  it('under `group` the same insert is refused', async () => {
    const verdict = await insertVerdict(undeclared(), { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] }, 'group');
    expect(verdict?.admitted).toBe(false);
    expect(verdict?.message).toContain("'ext_customer' states none");
  });

  it('CONTROL: the declared shared object admits the same insert', async () => {
    const schema = { name: 'ext_customer', external: { remoteName: 'customers' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS };
    const verdict = await insertVerdict(schema, MEMBER_CTX);
    expect(verdict?.admitted).toBe(true);
  });

  it('CONTROL: under `single` the undeclared object admits the insert as before', async () => {
    const verdict = await insertVerdict(undeclared(), MEMBER_CTX, 'single');
    expect(verdict?.admitted).toBe(true);
  });
});

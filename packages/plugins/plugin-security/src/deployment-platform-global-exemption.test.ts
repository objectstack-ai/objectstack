// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12699 → ADR-0131 D7] The deployment-declared platform-global carve-out, as
 * plugin-security sees it now that the declaration is total.
 *
 * The mounted `org-scoping` service may declare
 * `OrgScopingEntitlement.platformGlobalObjects`. This plugin used to fold that
 * list into `tenancyDisabled` — a Layer 0 STAND-DOWN on an object that still
 * carried its organization column, so the driver went on scoping what the wall
 * had stopped scoping. ADR-0131 D7 retires that stand-down ("replaced by D7's
 * no-column"): the declaration is the injected-columns plan's input, and the
 * engine's registry registers a declared object with no `organization_id` and
 * declaring `systemFields.tenant: false`. What this plugin promises after that:
 *
 *   1. it reads NO `platformGlobalObjects`: an object that still carries its
 *      column is walled, whatever the service declares — on reads and on the
 *      ADR-0123 D2 write path (the same choke point);
 *   2. an object registered the way the registry registers a declared one is
 *      not walled — through its own `systemFields.tenant: false`, the clause
 *      every deployment-level object answers from;
 *   3. a junk `platformGlobalObjects` is the engine's to refuse (it consumes
 *      it); this plugin warns only for the key it reads,
 *      `suppressUnboundedOrgAdminGrant`, once per boot;
 *   4. the arming log announces the grant suppression, not the list.
 *
 * The booted-kernel end of the same contract — the provider, the plan, the
 * DDL, the driver — is `platform-global-no-organization-column.test.ts`.
 *
 * Harness pattern: `federated-tenant-layer0.test.ts` — a SecurityPlugin over a
 * fake ObjectQL, asserting the composed FilterCondition before any driver sees
 * it. The caller is a plain member (no policies), so the only thing
 * `getReadFilter` can return is Layer 0 — the layer under test.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** An ordinary member of `org-1`: no superuser bit, no positions. */
const MEMBER_CTX = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };
/** The same member with NO active organization — the ADR-0123 D2 write case. */
const NO_ORG_CTX = { userId: 'u1', positions: [], permissions: [] };

/** An ordinary local tenant object, still carrying its organization column. */
const walledSchema = (name: string) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
  },
});

/** The same object as the registry registers it on a deployment that declares it. */
const plannedSchema = (name: string) => ({
  name,
  systemFields: { tenant: false },
  fields: { title: { type: 'text', label: 'Title' } },
});

async function boot(
  schemas: Record<string, Record<string, unknown>>,
  opts: { entitlement?: Record<string, unknown>; tenancy?: { posture: string } } = {},
) {
  const getSchema = (name: string) => schemas[name];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema, findOne: vi.fn(async () => null) },
    metadata: {
      get: async (_type: string, name: string) => schemas[name],
      list: async () => [PLAIN_MEMBER],
    },
    'org-scoping': { name: 'com.objectstack.org-scoping', ...(opts.entitlement ?? {}) },
  };
  if (opts.tenancy) services['tenancy'] = opts.tenancy;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx: Record<string, unknown> = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.init(ctx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.start(ctx as any);
  return { plugin, logger };
}

describe('[ADR-0131 D7] plugin-security reads no platformGlobalObjects — the stand-down is retired', () => {
  it('a declared object that still carries its column is WALLED (`isolated`) — reads', async () => {
    const { plugin } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      { entitlement: { platformGlobalObjects: ['sys_widget_registry'] } },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toEqual({
      organization_id: 'org-1',
    });
  });

  it('…and `group`: the union wall stands on it', async () => {
    const { plugin } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      { entitlement: { platformGlobalObjects: ['sys_widget_registry'] }, tenancy: { posture: 'group' } },
    );
    const groupCtx = { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', groupCtx)).toEqual({
      organization_id: { $in: ['org-1', 'org-2'] },
    });
  });

  it('…and the ADR-0123 D2 write wall (the same choke point) refuses an org-less insert on it', async () => {
    const { plugin } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      { entitlement: { platformGlobalObjects: ['sys_widget_registry'] } },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walled = await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER], 'sys_widget_registry', 'insert', NO_ORG_CTX,
    );
    expect(walled).toEqual({ ...RLS_DENY_FILTER });
  });

  it('the object as the registry registers it on the declaring deployment is NOT walled — its own clause answers', async () => {
    const { plugin } = await boot({
      sys_widget_registry: plannedSchema('sys_widget_registry'),
      crm_task: walledSchema('crm_task'),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER], 'sys_widget_registry', 'insert', NO_ORG_CTX,
    )).toBeNull();
    // CONTROL — a sibling on the same deployment walls as today.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toEqual({ organization_id: 'org-1' });
  });

  it('`single` posture: Layer 0 is inert on both, declaration or not', async () => {
    const { plugin } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry'), crm_task: walledSchema('crm_task') },
      { entitlement: { platformGlobalObjects: ['sys_widget_registry'] }, tenancy: { posture: 'single' } },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toBeUndefined();
  });
});

describe('[#12699] refusals: this plugin warns only for the key it reads', () => {
  it('a junk platformGlobalObjects is not this plugin\'s to warn about (the engine consumes and refuses it)', async () => {
    const { plugin, logger } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      { entitlement: { platformGlobalObjects: 'sys_widget_registry' } },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes('org-scoping entitlement key'))).toEqual([]);
  });

  it('a junk suppressUnboundedOrgAdminGrant is warned ONCE per boot, naming the key', async () => {
    const { logger } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      { entitlement: { suppressUnboundedOrgAdminGrant: 'yes' } },
    );
    const refusals = logger.warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("'suppressUnboundedOrgAdminGrant' REFUSED"));
    expect(refusals).toHaveLength(1);
  });
});

describe('[#12699] the arming log', () => {
  it('announces the grant suppression; the platform-global list is the engine\'s to announce', async () => {
    const { logger } = await boot(
      { sys_widget_registry: walledSchema('sys_widget_registry') },
      {
        entitlement: {
          platformGlobalObjects: ['sys_widget_registry'],
          suppressUnboundedOrgAdminGrant: true,
        },
      },
    );
    const infos = logger.info.mock.calls.map((c) => String(c[0]));
    expect(infos.some((m) => m.includes('suppresses the unbounded organization_admin auto-grant'))).toBe(true);
    expect(infos.some((m) => m.includes('platform-global'))).toBe(false);
  });
});

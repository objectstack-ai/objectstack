// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12699 / cloud#1653] Deployment-declared platform-global exemption.
 *
 * The mounted `org-scoping` service may declare
 * `OrgScopingEntitlement.platformGlobalObjects` — objects THIS deployment
 * owns platform-globally, which Layer 0 must not wall HERE even though the
 * same objects genuinely wall on tenant runtimes (which is why the per-object
 * `tenancy: { enabled: false }` authoring channel cannot express the fact:
 * that declaration travels with the object into every deployment).
 *
 * These cases pin the four properties the contract promises:
 *
 *   1. an exempted object is not walled on this deployment — on the read path
 *      AND on the ADR-0123 D2 write-refusal path, because both are the same
 *      `computeLayeredRlsFilter().layer0` (the single choke point);
 *   2. a non-exempted object walls exactly as before (the exemption is a
 *      carve-out, never a widening);
 *   3. an ABSENT declaration is byte-identical to today (fail closed) — and so
 *      is a JUNK one, refused loudly per the `MembershipPolicy` precedent;
 *   4. the exemption composes with, never replaces, the object-level
 *      `tenancy: { enabled: false }` channel.
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

/** Two ordinary local tenant objects — identical shapes, different names. */
const localSchema = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
  },
  ...extra,
});

/**
 * Boot a SecurityPlugin over per-name schemas, with the `org-scoping` service
 * carrying `entitlement` (the deployment's declaration). Returns the plugin and
 * the fake logger so cases can assert the loud-refusal channel.
 */
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

const TWO_OBJECTS = {
  sys_widget_registry: localSchema('sys_widget_registry'),
  crm_task: localSchema('crm_task'),
};

describe('[#12699] platformGlobalObjects — the deployment carve-out', () => {
  it('an exempted object is NOT walled on this deployment (`isolated`)', async () => {
    const { plugin } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry'] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX);
    expect(filter).toBeUndefined();
  });

  it('a NON-exempted object still walls exactly as before', async () => {
    const { plugin } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry'] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = await (plugin as any).getReadFilter('crm_task', MEMBER_CTX);
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('`group` posture: the exemption holds and the union wall stays on the sibling', async () => {
    const { plugin } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry'] },
      tenancy: { posture: 'group' },
    });
    const groupCtx = { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', groupCtx)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('crm_task', groupCtx)).toEqual({
      organization_id: { $in: ['org-1', 'org-2'] },
    });
  });

  it('the ADR-0123 D2 write wall derives from the SAME choke point: an exempted object escapes the no-active-org refusal, a sibling does not', async () => {
    const { plugin } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry'] },
    });
    // computeWriteTenantCheckFilter IS computeLayeredRlsFilter().layer0 — the
    // derivation the middleware's refusal reads. Null = Layer 0 contributes
    // nothing (the write may land); the deny sentinel = refusal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exempted = await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER], 'sys_widget_registry', 'insert', NO_ORG_CTX,
    );
    expect(exempted).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walled = await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER], 'crm_task', 'insert', NO_ORG_CTX,
    );
    expect(walled).toEqual({ ...RLS_DENY_FILTER });
  });

  it('REGRESSION PIN — no declaration ⇒ byte-identical to today: both objects wall', async () => {
    const { plugin, logger } = await boot(TWO_OBJECTS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toEqual({
      organization_id: 'org-1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toEqual({
      organization_id: 'org-1',
    });
    // And nothing to refuse means nothing to warn about.
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes('#12699'))).toEqual([]);
  });

  it('composes with, never replaces, the object-level channel: `tenancy.enabled:false` stays exempt with no deployment declaration', async () => {
    const { plugin } = await boot({
      sys_catalog: localSchema('sys_catalog', { tenancy: { enabled: false } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_catalog', MEMBER_CTX)).toBeUndefined();
  });

  it('`single` posture: the declaration decides nothing (Layer 0 is inert either way)', async () => {
    const { plugin } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry'] },
      tenancy: { posture: 'single' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toBeUndefined();
  });
});

describe('[#12699] junk declarations are REFUSED loudly, never coerced (MembershipPolicy precedent)', () => {
  it('a bare string is refused: warn names the key, and the named object STILL walls', async () => {
    const { plugin, logger } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: 'sys_widget_registry' },
    });
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes("'platformGlobalObjects' REFUSED"))).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toEqual({
      organization_id: 'org-1',
    });
  });

  it('one junk ENTRY voids the whole key (no partial honouring): a wildcard poisons the list', async () => {
    const { plugin, logger } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: ['sys_widget_registry', '*'] },
    });
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes("'platformGlobalObjects' REFUSED"))).toBe(true);
    // The well-formed entry is NOT honoured — refusal is whole-key, fail closed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toEqual({
      organization_id: 'org-1',
    });
  });

  it('junk in one key does not void the other: a bad suppress flag leaves a valid exemption standing', async () => {
    const { plugin, logger } = await boot(TWO_OBJECTS, {
      entitlement: {
        platformGlobalObjects: ['sys_widget_registry'],
        suppressUnboundedOrgAdminGrant: 'yes',
      },
    });
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes("'suppressUnboundedOrgAdminGrant' REFUSED"))).toBe(true);
    expect(warned.some((m) => m.includes("'platformGlobalObjects' REFUSED"))).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX)).toBeUndefined();
  });

  it('the refusal is warned ONCE per boot, not once per read', async () => {
    const { plugin, logger } = await boot(TWO_OBJECTS, {
      entitlement: { platformGlobalObjects: 42 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin as any).getReadFilter('sys_widget_registry', MEMBER_CTX);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin as any).getReadFilter('crm_task', MEMBER_CTX);
    const refusals = logger.warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("'platformGlobalObjects' REFUSED"));
    expect(refusals).toHaveLength(1);
  });
});

describe('[#12699] the arming log surfaces the declaration', () => {
  it('a walled boot with exemptions logs the carve-out (count + names)', async () => {
    const { logger } = await boot(TWO_OBJECTS, {
      entitlement: {
        platformGlobalObjects: ['sys_widget_registry'],
        suppressUnboundedOrgAdminGrant: true,
      },
    });
    const infos = logger.info.mock.calls.map((c) => String(c[0]));
    expect(infos.some((m) => m.includes('1 platform-global'))).toBe(true);
    expect(infos.some((m) => m.includes('suppresses the unbounded organization_admin auto-grant'))).toBe(true);
  });
});

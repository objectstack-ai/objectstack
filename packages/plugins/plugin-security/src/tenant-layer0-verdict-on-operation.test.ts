// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15813] The security middleware RECORDS its Layer 0 verdict on the
 * operation context — `opCtx.tenantLayer0Verdict` — at the moment it composes
 * the wall onto the operation's predicate, so a producer downstream
 * (`publishBulkDataEvent`, `@objectstack/objectql`) reads what the wall
 * decided instead of re-deriving it (the #15706 ruling: seam (i)).
 *
 * What these pins hold:
 *
 *  1. The recorded verdict IS the wall that was composed — every case reads
 *     the verdict AND the injected `ast.where` off ONE middleware pass, so a
 *     verdict that disagreed with the predicate would fail here first.
 *  2. The populations the engine could never answer are answered HERE, from
 *     inputs only this plugin sees: the deployment's #12699 carve-out (`none`
 *     under an armed wall — the #15706 population), a `PLATFORM_ADMIN` rung
 *     on a PUBLIC tenant object (`organization` — the wall stands), a
 *     `PLATFORM_ADMIN` on a posture-permitting object (`none` — the wall was
 *     crossed), and a hand-built context carrying no rung whose exemption
 *     the capability probe decides.
 *  3. Nothing is recorded where no wall was composed: a system context (the
 *     middleware's first exit) and a by-id write (no predicate to compose
 *     onto). Absence is a distinct state from `none`.
 *
 * Harness: `deployment-platform-global-exemption.test.ts` — a SecurityPlugin
 * over a fake ObjectQL. The registered middleware is captured and driven with
 * a hand-built predicate-write `opCtx`; `next` is a no-op, so the assertion is
 * about what the middleware left on the context, not about a driver.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const ADMIN_SET = defaultPermissionSets.find((s) => s.name === ADMIN_FULL_ACCESS);
if (!ADMIN_SET) throw new Error(`fixture: '${ADMIN_FULL_ACCESS}' is not among the default permission sets`);

/**
 * An explicit per-object grant on the PRIVATE object: a wildcard `'*'` grant
 * does not reach a private object (ADR-0066), so a plain member holding only
 * `member_default` is refused at the CRUD gate before any wall is composed.
 * This set lets the rungless-member half of the probe pin REACH the wall,
 * carrying no superuser bit and no platform capability.
 */
const SECRET_EDITOR: PermissionSet = {
  name: 'secret_editor',
  label: 'Secret editor',
  objects: { crm_secret: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** An ordinary member of `org-1`, rung carried as the authz resolver would. */
const MEMBER_CTX = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };

const localSchema = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
  },
  ...extra,
});

const SCHEMAS: Record<string, Record<string, unknown>> = {
  crm_task: localSchema('crm_task'),
  sys_widget_registry: localSchema('sys_widget_registry'),
  sys_catalog: localSchema('sys_catalog', { tenancy: { enabled: false } }),
  crm_secret: localSchema('crm_secret', { access: { default: 'private' } }),
};

async function boot(opts: { entitlement?: Record<string, unknown>; tenancy?: { posture: string }; sets?: PermissionSet[] } = {}) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      findOne: vi.fn(async () => null),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => opts.sets ?? [PLAIN_MEMBER],
    },
    'org-scoping': { name: 'com.objectstack.org-scoping', ...(opts.entitlement ?? {}) },
  };
  if (opts.tenancy) services['tenancy'] = opts.tenancy;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: Record<string, unknown> = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  return { plugin, logger, middleware: middlewares[0] };
}

/** A predicate write — the `multi: true` shape, which carries an `ast`. */
function sweep(object: string, operation: 'update' | 'delete', context: Record<string, unknown>) {
  const where = { status: 'open' };
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    options: { where, multi: true },
    ast: { where },
  };
  if (operation === 'update') opCtx.data = { title: 'swept' };
  return opCtx;
}

const hasVerdict = (opCtx: any) => Object.prototype.hasOwnProperty.call(opCtx, 'tenantLayer0Verdict');
const injectedOrgWall = (opCtx: any): unknown => {
  // The wall is AND-ed under the caller's predicate; find the organization_id clause.
  const walk = (node: any): unknown => {
    if (!node || typeof node !== 'object') return undefined;
    if ('organization_id' in node) return node.organization_id;
    for (const part of node.$and ?? []) {
      const hit = walk(part);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return walk(opCtx.ast?.where);
};

describe('[#15813] the middleware records the Layer 0 verdict it composed — one pass, verdict and predicate agree', () => {
  it('`isolated`, a member with an active organization: `organization`, and the injected wall is that equality', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('the predicate DELETE path records it too', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'delete', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('`group`: `organizations` is the membership SET, and the injected wall is the same set', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'group' } });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: ['org-1', 'org-2'] });
    expect(injectedOrgWall(opCtx)).toEqual({ $in: ['org-1', 'org-2'] });
  });

  it('`group` with a repeated membership records the organization ONCE — a set, so a reader may test length === 1', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'group' } });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-1'] });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: ['org-1'] });
    expect(injectedOrgWall(opCtx)).toEqual({ $in: ['org-1'] });
  });

  it('`single`: `none` — the wall ran and contributed nothing; nothing is injected', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'single' } });
    const opCtx = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });

  it('an org-less caller under `isolated` records `deny` on a predicate DELETE — the fail-closed sentinel, not an organization', async () => {
    // `delete` is deliberately outside the ADR-0123 D2 write refusal (it
    // places no row), so the operation reaches the wall and the wall denies.
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'delete', { userId: 'u1', positions: [], permissions: [], posture: 'MEMBER' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'deny' });
  });
});

describe('[#15813] the populations the engine could never answer are answered where the wall is computed', () => {
  it('the deployment\'s #12699 carve-out: an exempted object under an armed wall records `none` — the #15706 population', async () => {
    const { middleware } = await boot({ entitlement: { platformGlobalObjects: ['sys_widget_registry'] } });
    const exempted = sweep('sys_widget_registry', 'update', MEMBER_CTX);
    await middleware(exempted, async () => {});
    expect(exempted.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(exempted)).toBeUndefined();
    // Firing control on the same deployment: the sibling is walled and says so.
    const sibling = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(sibling, async () => {});
    expect(sibling.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
  });

  it('an object that opted out of tenancy (`tenancy.enabled: false`) records `none`', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('sys_catalog', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
  });

  it('a `PLATFORM_ADMIN` rung on a PUBLIC tenant object records `organization` — the wall STANDS there (the engine answered this absent)', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet] });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('a `PLATFORM_ADMIN` on a posture-permitting (private) object records `none` — the wall was crossed, so no organization is asserted', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet] });
    const opCtx = sweep('crm_secret', 'update', { ...MEMBER_CTX, permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });

  it('a hand-built context carrying NO rung is decided by the capability probe: platform caps cross a private object, a plain member does not', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet, SECRET_EDITOR] });
    const { posture: _drop, ...rungless } = MEMBER_CTX;
    const admin = sweep('crm_secret', 'update', { ...rungless, permissions: [ADMIN_FULL_ACCESS] });
    await middleware(admin, async () => {});
    expect(admin.tenantLayer0Verdict).toEqual({ kind: 'none' });
    // Same private object, same absent rung, an explicit grant instead of the
    // platform set: the probe finds no platform capability and the wall stands.
    const member = sweep('crm_secret', 'update', { ...rungless, permissions: ['secret_editor'] });
    await middleware(member, async () => {});
    expect(member.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
  });
});

describe('[#15813] nothing is recorded where no wall was composed — absence is a distinct state', () => {
  it('a system context takes the middleware\'s first exit: no verdict member at all', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'update', { isSystem: true, userId: 'usr_system', tenantId: 'org-1' });
    await middleware(opCtx, async () => {});
    expect(hasVerdict(opCtx)).toBe(false);
  });

  it('a by-id write carries no predicate to compose onto: no verdict member', async () => {
    const { middleware } = await boot();
    const opCtx: any = { object: 'crm_task', operation: 'update', data: { id: 'r1', title: 'x' }, context: { ...MEMBER_CTX } };
    // The pre-image gate re-reads the row through the (fake) engine and refuses
    // a row it cannot see — irrelevant here: the assertion is about what the
    // middleware left on the context, and step 3 is never reached without an ast.
    await middleware(opCtx, async () => {}).catch(() => undefined);
    expect(hasVerdict(opCtx)).toBe(false);
  });

  it('the public `getReadFilter` (no operation context) is byte-identical: the filter is the verdict\'s projection', async () => {
    const { plugin } = await boot();
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toEqual({ organization_id: 'org-1' });
    expect(await (plugin as any).getReadFilter('sys_catalog', MEMBER_CTX)).toBeUndefined();
  });
});

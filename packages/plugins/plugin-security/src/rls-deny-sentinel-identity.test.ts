// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D2 step 2] Every deny `getReadFilter` answers IS the spec's
 * `RLS_DENY_FILTER` — the same object, by reference — so the engine's
 * composition can recognise it by identity and answer `$in: []`.
 *
 * The sentinel is declared once, in `@objectstack/spec/data`; this plugin
 * re-exports it under the name every consumer here imports and holds no second
 * literal. Each case below drives one deny return through the public method and
 * pins it with `toBe` against the spec's export, never `toEqual`: a spread copy
 * carries the same value and matches zero rows too, which is exactly why a
 * value assertion cannot tell the two apart, and why the copies stood for so
 * long.
 *
 * The returns, by where they are produced:
 *
 *  - in `getReadFilter` itself: a principal-less context, a sharing-scope
 *    resolution failure, an on-behalf-of context, a caller who resolves no
 *    permission set, and a permission-resolution throw;
 *  - in a layer whose answer comes up unchanged when it is the only one that
 *    constrains: the tenant wall's deny (Layer 0, `tenantLayer0FilterOf`), the
 *    "every applicable policy dropped for a missing column" deny (Layer 1),
 *    the RLS compiler's own deny, and the unresolvable-master deny of a
 *    `controlled_by_parent` object.
 *
 * Plus the one downstream property the by-reference return leans on: the CRUD
 * middleware injects the frozen sentinel into `ast.where` without mutating it.
 *
 * Fixtures are synthetic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { RLS_DENY_FILTER as SPEC_RLS_DENY_FILTER } from '@objectstack/spec/data';
import { SecurityPlugin } from './security-plugin.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { RLS_DENY_FILTER as PACKAGE_RLS_DENY_FILTER } from './index.js';
import { computeTenantLayer0Filter, tenantLayer0FilterOf } from './tenant-layer.js';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/** Object access everywhere, and no row-level policy: no Layer 1 at all. */
const OPEN_SET = { name: 'member_default', label: 'Synthetic member', objects: { '*': CRUD } } as unknown as PermissionSet;

/** The platform's wildcard tenant policy shape, which needs `organization_id`. */
const TENANT_POLICY_SET = {
  name: 'member_default',
  label: 'Synthetic member',
  objects: { '*': CRUD },
  rowLevelSecurity: [
    { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id == current_user.organization_id' },
  ],
} as unknown as PermissionSet;

/** A policy the compiler cannot evaluate for a member: a `current_user` key nothing resolves. */
const UNRESOLVABLE_POLICY_SET = {
  name: 'member_default',
  label: 'Synthetic member',
  objects: { '*': CRUD },
  rowLevelSecurity: [
    { name: 'region_scope', object: 'task', operation: 'select', using: 'owner_id == current_user.synthetic_unresolved_key' },
  ],
} as unknown as PermissionSet;

const MEMBER = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

interface Deployment {
  sets: PermissionSet[];
  fields?: string[];
  schemaExtra?: Record<string, unknown>;
  orgScoping?: boolean;
  sharing?: unknown;
  noBaseline?: boolean;
}

async function boot(deployment: Deployment) {
  const fields: Record<string, unknown> = {};
  for (const f of deployment.fields ?? ['id', 'organization_id', 'owner_id', 'name']) fields[f] = { name: f, type: 'text' };
  const schema = { name: 'task', fields, ...(deployment.schemaExtra ?? {}) };
  let middleware: ((opCtx: any, next: () => Promise<void>) => Promise<void>) | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
      getSchema: () => schema,
      // No row is ever read here: none of the deny paths reaches the store.
      find: vi.fn(async () => [] as Record<string, unknown>[]),
    },
    metadata: { get: async () => schema, list: async () => deployment.sets },
  };
  if (deployment.orgScoping) services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
  if (deployment.sharing) services['sharing'] = deployment.sharing;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: any = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin(
    deployment.noBaseline
      ? { defaultPermissionSets: [], fallbackPermissionSet: null }
      : { fallbackPermissionSet: 'member_default' },
  );
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (!middleware) throw new Error('SecurityPlugin registered no middleware');
  return { plugin, middleware, logger };
}

describe('[ADR-0139 D2 step 2] one sentinel in the tree: this plugin re-exports the spec object', () => {
  it('rls-compiler and the package entry export the spec\'s object itself, not a copy', () => {
    expect(RLS_DENY_FILTER).toBe(SPEC_RLS_DENY_FILTER);
    expect(PACKAGE_RLS_DENY_FILTER).toBe(SPEC_RLS_DENY_FILTER);
    expect(Object.isFrozen(RLS_DENY_FILTER)).toBe(true);
  });

  it('the tenant wall\'s deny is the spec object, from the projection and from the computation', () => {
    expect(tenantLayer0FilterOf({ kind: 'deny' })).toBe(SPEC_RLS_DENY_FILTER);
    const walledWithoutOrganization = computeTenantLayer0Filter({
      tenancyPosture: 'isolated',
      organizationId: undefined,
      objectHasOrgIdField: true,
      tenancyDisabled: false,
      posturePermitsCrossTenant: false,
      isPlatformAdmin: false,
    });
    expect(walledWithoutOrganization).toBe(SPEC_RLS_DENY_FILTER);
    // CONTROL: a wall with an organization is a fresh predicate, never the sentinel.
    expect(tenantLayer0FilterOf({ kind: 'organization', organizationId: 'org-1' })).toEqual({ organization_id: 'org-1' });
  });

  it('the RLS compiler\'s "every applicable policy dropped" deny is the spec object', () => {
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: vi.fn() });
    const policy = { name: 'region_scope', object: 'task', operation: 'select', using: 'owner_id == current_user.synthetic_unresolved_key' };
    expect(compiler.compileFilter([policy as never], { userId: 'u1' } as never)).toBe(SPEC_RLS_DENY_FILTER);
  });
});

describe('[ADR-0139 D2 step 2] every getReadFilter deny return is the spec sentinel BY REFERENCE', () => {
  it('a principal-less context (ADR-0096 D5)', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET] });
    expect(await plugin.getReadFilter('task', { positions: [], permissions: [] })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('a sharing (OWD) scope that cannot be resolved', async () => {
    const sharing = { buildReadFilter: vi.fn(async () => { throw new Error('synthetic sharing outage'); }) };
    const { plugin, logger } = await boot({ sets: [OPEN_SET], sharing });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
    expect(sharing.buildReadFilter).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('an on-behalf-of context (the D10 intersection is not on this path)', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET] });
    expect(await plugin.getReadFilter('task', { ...MEMBER, onBehalfOf: { userId: 'u_delegator' } })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('a caller who resolves no permission set (ADR-0056 D2 deny baseline)', async () => {
    const { plugin } = await boot({ sets: [], noBaseline: true });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('a permission-resolution throw', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET] });
    (plugin as any).permissionEvaluator.resolvePermissionSets = async () => {
      throw new Error('synthetic metadata outage');
    };
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('the tenant wall\'s deny, when it is the only layer that constrains', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET], orgScoping: true });
    expect(await plugin.getReadFilter('task', { ...MEMBER, tenantId: undefined })).toBe(SPEC_RLS_DENY_FILTER);
    // CONTROL: the same caller WITH an organization is walled, not denied.
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toEqual({ organization_id: 'org-1' });
  });

  it('every applicable policy dropped for a column the object lacks (Layer 1)', async () => {
    const { plugin } = await boot({ sets: [TENANT_POLICY_SET], fields: ['id', 'owner_id', 'name'], orgScoping: true });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('the RLS compiler\'s deny, when every applicable policy fails to compile', async () => {
    const { plugin } = await boot({ sets: [UNRESOLVABLE_POLICY_SET] });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('a controlled_by_parent object whose master cannot be resolved', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET], schemaExtra: { sharingModel: 'controlled_by_parent' } });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBe(SPEC_RLS_DENY_FILTER);
  });

  it('CONTROL: an open member with no wall and no policy has no row restriction', async () => {
    const { plugin } = await boot({ sets: [OPEN_SET] });
    expect(await plugin.getReadFilter('task', { ...MEMBER })).toBeUndefined();
  });
});

describe('[ADR-0139 D2 step 2] the CRUD middleware carries the frozen sentinel without mutating it', () => {
  it('a walled read with no organization injects the spec object itself as the where, and leaves it unedited', async () => {
    const { middleware } = await boot({ sets: [OPEN_SET], orgScoping: true });
    const opCtx: any = {
      object: 'task',
      operation: 'find',
      context: { ...MEMBER, tenantId: undefined },
      options: {},
      ast: { where: undefined },
    };
    let ran = false;
    await middleware(opCtx, async () => { ran = true; });
    expect(ran).toBe(true);
    expect(opCtx.ast.where).toBe(SPEC_RLS_DENY_FILTER);
    expect(SPEC_RLS_DENY_FILTER).toEqual({ id: expect.stringMatching(/^__rls_deny__:/) });
    expect(Object.keys(SPEC_RLS_DENY_FILTER)).toEqual(['id']);
  });
});

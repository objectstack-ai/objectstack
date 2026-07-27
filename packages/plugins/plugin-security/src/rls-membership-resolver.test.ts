// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D11] The `rls-membership-resolver` seam has a PRODUCER.
 *
 * `ExecutionContext.rlsMembership` and the compiler's merge of it have existed
 * since ADR-0056, but nothing in production ever populated the bag — a declared
 * capability with no producer, which is the ADR-0049 defect. These tests pin the
 * producer end-to-end: a registered resolver's sets reach the compiled filter,
 * and every failure mode narrows access rather than widening it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/** Policy shape the seam exists for: set membership with no subquery support. */
const territorySet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true } },
  rowLevelSecurity: [
    {
      name: 'account_territory_scope',
      object: 'task',
      operation: 'select',
      using: 'assigned_to_id IN (current_user.territory_user_ids)',
    },
  ],
} as any;

function makeCtx(resolver?: unknown) {
  const schema: any = {
    name: 'task',
    fields: { id: { name: 'id' }, assigned_to_id: { name: 'assigned_to_id' } },
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: () => {}, getSchema: () => schema, findOne: async () => null },
    metadata: { get: async () => schema, list: async () => [territorySet] },
  };
  if (resolver) services['rls-membership-resolver'] = resolver;
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  } as any;
}

async function readFilter(resolver: unknown, context: Record<string, unknown>) {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const ctx = makeCtx(resolver);
  await plugin.init(ctx);
  await plugin.start(ctx);
  return { filter: await plugin.getReadFilter('task', context as any), ctx };
}

const caller = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

describe('rls-membership-resolver (ADR-0105 D11)', () => {
  it('stages a registered resolver\'s set into the compiled filter', async () => {
    const resolver = {
      keys: ['territory_user_ids'],
      resolve: vi.fn(async () => ({ territory_user_ids: ['u2', 'u3'] })),
    };
    const { filter } = await readFilter(resolver, { ...caller });
    expect(filter).toEqual({ assigned_to_id: { $in: ['u2', 'u3'] } });
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tenantId: 'org-1' }),
    );
  });

  it('passes the caller\'s org access set to the resolver (ADR-0105 D2)', async () => {
    const resolver = {
      keys: ['territory_user_ids'],
      resolve: vi.fn(async () => ({ territory_user_ids: ['u2'] })),
    };
    await readFilter(resolver, { ...caller, accessible_org_ids: ['org-1', 'org-2'] });
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ accessible_org_ids: ['org-1', 'org-2'] }),
    );
  });

  it('fails CLOSED when no resolver is registered (the pre-D11 state)', async () => {
    const { filter } = await readFilter(undefined, { ...caller });
    // The key never resolves → the only policy drops out → deny sentinel.
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('fails CLOSED when the resolver throws', async () => {
    const resolver = {
      keys: ['territory_user_ids'],
      resolve: vi.fn(async () => {
        throw new Error('territory service down');
      }),
    };
    const { filter, ctx } = await readFilter(resolver, { ...caller });
    expect(filter).toEqual(RLS_DENY_FILTER);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('rls-membership-resolver threw'),
      expect.anything(),
    );
  });

  it('fails CLOSED when the resolver returns an EMPTY set', async () => {
    const resolver = { keys: ['territory_user_ids'], resolve: async () => ({ territory_user_ids: [] }) };
    const { filter } = await readFilter(resolver, { ...caller });
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('refuses to let a resolver overwrite a RESERVED kernel key', async () => {
    // An app that could redefine `accessible_org_ids` could redefine the group
    // posture's wall — so the reserved keys are not writable from this seam.
    const resolver = {
      keys: ['territory_user_ids'],
      resolve: async () => ({
        territory_user_ids: ['u2'],
        accessible_org_ids: ['org-victim'],
      }),
    };
    const context: Record<string, unknown> = { ...caller, accessible_org_ids: ['org-1'] };
    const { filter, ctx } = await readFilter(resolver, context);
    expect(filter).toEqual({ assigned_to_id: { $in: ['u2'] } });
    expect((context.rlsMembership as any)?.accessible_org_ids).toBeUndefined();
    expect(context.accessible_org_ids).toEqual(['org-1']);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('RESERVED context key'),
      { key: 'accessible_org_ids' },
    );
  });

  it('resolves once per request context, not once per object touched', async () => {
    const resolver = {
      keys: ['territory_user_ids'],
      resolve: vi.fn(async () => ({ territory_user_ids: ['u2'] })),
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const ctx = makeCtx(resolver);
    await plugin.init(ctx);
    await plugin.start(ctx);
    const context = { ...caller };
    await plugin.getReadFilter('task', context as any);
    await plugin.getReadFilter('task', context as any);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });
});

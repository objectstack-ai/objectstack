// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D3] `current_user.queues` is resolved by the security plugin from
 * the ownership-queue service, and by nothing else: a member reads the records
 * sitting in their queues, a non-member reads none, and an app resolver that
 * answers `queues` is screened off the reserved key and fails closed.
 *
 * Driven through the whole plugin (`getReadFilter`), so the staging, the
 * resolver screen and the compiler merge are the real ones.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { OWNERSHIP_QUEUE_SERVICE, RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';

import { RLS_DENY_FILTER } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';
import { kernelQueuesOf, stageKernelQueues } from './kernel-queue-membership.js';

const bytes = (v: unknown): string => JSON.stringify(v);

const QUEUE_POLICY = { name: 'sitting', object: 'case', operation: 'select', using: 'queue in current_user.queues' };
const OWNER_POLICY = { name: 'own', object: 'case', operation: 'select', using: 'owner_id == current_user.id' };

/** Who sits in which queue, per organization — the fake service's one answer. */
const MEMBERSHIP: Record<string, Record<string, string[]>> = {
  org_a: { u_member: ['billing', 'support_tier1'] },
  org_b: { u_member: ['org_b_only'] },
};

function queueService(overrides: Partial<{ queuesOf: (u: string, o: string | null) => Promise<string[]> }> = {}) {
  const queuesOf = vi.fn(
    overrides.queuesOf ?? (async (userId: string, org: string | null) => MEMBERSHIP[org ?? '']?.[userId] ?? []),
  );
  return {
    queuesOf,
    resolveQueue: async () => null,
    isMember: async (userId: string, name: string, org: string | null) =>
      (MEMBERSHIP[org ?? '']?.[userId] ?? []).includes(name),
  };
}

function makeHost(opts: { queues?: unknown; resolver?: unknown; warn?: (...a: unknown[]) => void; policies?: unknown[] }) {
  const schema = {
    name: 'case',
    fields: { id: { name: 'id' }, queue: { name: 'queue' }, owner_id: { name: 'owner_id' } },
  };
  const permSet: PermissionSet = {
    name: 'member_default',
    label: 'Member',
    objects: { '*': { allowRead: true } },
    rowLevelSecurity: opts.policies ?? [QUEUE_POLICY],
  } as never;
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: { registerMiddleware: () => {}, getSchema: () => schema, findOne: async () => null },
    metadata: { get: async () => schema, list: async () => [permSet] },
  };
  if (opts.queues) services[OWNERSHIP_QUEUE_SERVICE] = opts.queues;
  if (opts.resolver) services['rls-membership-resolver'] = opts.resolver;
  return {
    logger: { info: () => {}, warn: opts.warn ?? (() => {}), error: () => {}, debug: () => {} },
    registerService: () => {},
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  } as never;
}

async function startedPlugin(opts: Parameters<typeof makeHost>[0]) {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const host = makeHost(opts);
  await plugin.init(host);
  await plugin.start(host);
  return plugin as unknown as { getReadFilter(object: string, ctx: unknown): Promise<unknown> };
}

async function readFilter(opts: Parameters<typeof makeHost>[0], context: Record<string, unknown>) {
  return (await startedPlugin(opts)).getReadFilter('case', context);
}

describe('current_user.queues — the kernel resolves it from the ownership-queue service', () => {
  it('is a reserved key', () => {
    expect(RESERVED_RLS_MEMBERSHIP_KEYS).toContain('queues');
  });

  it('⭐ a member reads the records sitting in their queues, in the active organization', async () => {
    const queues = queueService();
    const filter = await readFilter({ queues }, { userId: 'u_member', tenantId: 'org_a' });
    expect(filter).toEqual({ queue: { $in: ['billing', 'support_tier1'] } });
    expect(queues.queuesOf).toHaveBeenCalledWith('u_member', 'org_a');
  });

  it('⭐ the organization decides the set: the same member in another organization reads that one\'s queues', async () => {
    const filter = await readFilter({ queues: queueService() }, { userId: 'u_member', tenantId: 'org_b' });
    expect(filter).toEqual({ queue: { $in: ['org_b_only'] } });
  });

  it('⭐ a non-member reads no sitting record — byte-identical to no queue service at all', async () => {
    const nonMember = await readFilter({ queues: queueService() }, { userId: 'u_outsider', tenantId: 'org_a' });
    const noService = await readFilter({}, { userId: 'u_outsider', tenantId: 'org_a' });
    expect(nonMember).toEqual(RLS_DENY_FILTER);
    expect(bytes(nonMember)).toBe(bytes(noService));
  });

  it('⭐ the set is the same answer the claim gate\'s isMember gives', async () => {
    const queues = queueService();
    const filter = (await readFilter({ queues }, { userId: 'u_member', tenantId: 'org_a' })) as {
      queue: { $in: string[] };
    };
    for (const name of filter.queue.$in) expect(await queues.isMember('u_member', name, 'org_a')).toBe(true);
  });

  it('resolves once per request, and only when a policy reads the key', async () => {
    const queues = queueService();
    const plugin = await startedPlugin({ queues });
    const ctx = { userId: 'u_member', tenantId: 'org_a' };
    await plugin.getReadFilter('case', ctx);
    await plugin.getReadFilter('case', ctx);
    expect(queues.queuesOf).toHaveBeenCalledTimes(1);

    const unread = queueService();
    await readFilter({ queues: unread, policies: [OWNER_POLICY] }, { userId: 'u_member', tenantId: 'org_a' });
    expect(unread.queuesOf).not.toHaveBeenCalled();
  });

  it('⛔ fails closed with no signed-in user, and when the service throws (one WARN)', async () => {
    const anonymous = queueService();
    expect(await readFilter({ queues: anonymous }, { tenantId: 'org_a' })).toEqual(RLS_DENY_FILTER);
    expect(anonymous.queuesOf).not.toHaveBeenCalled();

    const warn = vi.fn();
    const throwing = queueService({ queuesOf: async () => { throw new Error('sys_queue unavailable'); } });
    expect(await readFilter({ queues: throwing, warn }, { userId: 'u_member', tenantId: 'org_a' })).toEqual(
      RLS_DENY_FILTER,
    );
    expect(warn.mock.calls.some(([m]) => String(m).includes('queue membership could not be resolved'))).toBe(true);
  });
});

describe('current_user.queues — no source but the kernel', () => {
  /** An app resolver that claims the reserved key and seats every caller in a VIP queue. */
  const hostileResolver = {
    keys: ['queues', 'territory_ids'],
    resolve: async () => ({ queues: ['vip_escalations'], territory_ids: ['t1'] }),
  };

  it('⭐ an app resolver answering `queues` is screened (WARN) — the kernel set stands', async () => {
    const warn = vi.fn();
    const withResolver = await readFilter(
      { queues: queueService(), resolver: hostileResolver, warn },
      { userId: 'u_member', tenantId: 'org_a' },
    );
    const without = await readFilter({ queues: queueService() }, { userId: 'u_member', tenantId: 'org_a' });
    expect(bytes(withResolver)).toBe(bytes(without));
    expect(withResolver).toEqual({ queue: { $in: ['billing', 'support_tier1'] } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESERVED context key'), { key: 'queues' });
  });

  it('⭐ …and a non-member it tried to seat still reads nothing — fail closed', async () => {
    const filter = await readFilter(
      { queues: queueService(), resolver: hostileResolver },
      { userId: 'u_outsider', tenantId: 'org_a' },
    );
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('⭐ with no queue service, the resolver\'s `queues` does not fill the gap', async () => {
    const filter = await readFilter({ resolver: hostileResolver }, { userId: 'u_member', tenantId: 'org_a' });
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('⛔ a `queues` field or bag entry the caller puts on the context is never read', async () => {
    const filter = await readFilter(
      {},
      { userId: 'u_outsider', tenantId: 'org_a', queues: ['vip_escalations'], rlsMembership: { queues: ['vip_escalations'] } },
    );
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('⛔ a context copied for another principal or organization does not carry the staged set', async () => {
    const host = { logger: undefined, ownershipQueueMembership: () => queueService() };
    const ctx: Record<string, unknown> = { userId: 'u_member', tenantId: 'org_a' };
    await stageKernelQueues(host, ctx);
    expect(kernelQueuesOf(ctx)).toEqual(['billing', 'support_tier1']);
    expect(kernelQueuesOf({ ...ctx })).toEqual(['billing', 'support_tier1']);
    expect(kernelQueuesOf({ ...ctx, userId: 'u_delegator' })).toBeUndefined();
    expect(kernelQueuesOf({ ...ctx, tenantId: 'org_b' })).toBeUndefined();
  });
});

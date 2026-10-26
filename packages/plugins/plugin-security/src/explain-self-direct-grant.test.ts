// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25799] A self-explanation names both channels for a set held both through
 * the caller's own grant row and through a held position's definition, exactly
 * as explaining that user by id does.
 *
 * The request envelope a self-explanation runs on does not carry the
 * resolver's split of the two channels (its field set is closed), so
 * `explainAccessForCaller` resolves a HUMAN caller once more through
 * `resolveUserAuthzGrants` and attaches only that split. An agent and a guest
 * keep the context as it arrived; a resolution that fails is said, never
 * guessed.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG = 'org_self';
const OBJECT = 'leave_request';
const SCHEMA = { name: OBJECT, label: 'Leave request', systemFields: false, fields: { id: { name: 'id' } } };
const set = (name: string) => ({ name, label: name, objects: { [OBJECT]: { allowRead: true } }, systemPermissions: [] });

/** `crm_sales_user` reaches u1 through `sales_rep`'s definition AND u1's own grant row. */
const TABLES: Record<string, Array<Record<string, unknown>>> = {
  sys_user: [{ id: 'u1', email: 'u1@example.com' }],
  sys_member: [{ user_id: 'u1', organization_id: ORG, role: 'member' }],
  sys_user_position: [{ user_id: 'u1', position: 'sales_rep', organization_id: ORG }],
  sys_user_permission_set: [{ user_id: 'u1', permission_set: 'crm_sales_user', organization_id: ORG }],
};

async function plugin(opts: { failGrantRead?: boolean } = {}) {
  const ql: any = bindTestSecurityCatalog({
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === OBJECT ? SCHEMA : null),
    findOne: async () => null,
    async find(object: string, query: any) {
      if (opts.failGrantRead && object === 'sys_user_permission_set') throw new Error('store unavailable');
      const where = query?.where ?? {};
      return (TABLES[object] ?? []).filter((row) => Object.entries(where).every(([k, v]) =>
        v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(row[k]) : (v === null ? (row[k] ?? null) === null : row[k] === v)));
    },
  }, {
    positions: [{ name: 'sales_rep', permissionSets: ['crm_sales_user'] }],
    permissions: [set('crm_sales_user'), set('member_default')],
  });
  const metadata: any = {
    get: async (_type: string, name: string) => (name === OBJECT ? SCHEMA : null),
    list: async () => [set('member_default')],
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const p = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  await p.init(ctx);
  await p.start(ctx);
  return p;
}

/** The request envelope as a transport assembles it: grants flat, no channel split. */
const envelope = (over: Record<string, unknown>) => ({
  userId: 'u1',
  tenantId: ORG,
  positions: ['sales_rep', 'everyone'],
  permissions: ['crm_sales_user'],
  systemPermissions: [],
  posture: 'MEMBER',
  ...over,
});

const viaOf = (d: ExplainDecision, name: string): string | undefined =>
  d.layers.find((l) => l.layer === 'principal')?.contributors?.find((c) => c.kind === 'permission_set' && c.name === name)?.via;

describe('[#25799] a self-explanation reads the resolver\'s channel split', () => {
  it('a human caller holding a set directly and through a position sees both channels', async () => {
    const d = await (await plugin()).explainAccessForCaller({ object: OBJECT, operation: 'read' }, envelope({ principalKind: 'human' }));
    expect(viaOf(d, 'crm_sales_user')).toBe('direct grant + position:sales_rep');
  });

  it('…and when that resolution fails it says so, rather than guessing either way', async () => {
    const d = await (await plugin({ failGrantRead: true })).explainAccessForCaller({ object: OBJECT, operation: 'read' }, envelope({ principalKind: 'human' }));
    expect(viaOf(d, 'crm_sales_user')).toBe('position:sales_rep (whether a direct grant also names it could not be read)');
  });

  it('an agent acting for the user keeps the context as it arrived: no re-resolution, today\'s reading', async () => {
    const d = await (await plugin()).explainAccessForCaller(
      { object: OBJECT, operation: 'read' },
      envelope({ principalKind: 'agent', onBehalfOf: { userId: 'u1', principalKind: 'human' } }),
    );
    expect(viaOf(d, 'crm_sales_user')).toBe('position:sales_rep');
  });
});

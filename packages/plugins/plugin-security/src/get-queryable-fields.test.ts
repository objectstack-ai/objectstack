// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20935] `getQueryableFields` — the query-side twin of `getReadableFields`.
 *
 * The first block is an EQUIVALENCE, not a table of expected lists: for every
 * field of the object it drives the REAL registered middleware with a query
 * naming only that field — as a filter, as a sort key, as a group key and as an
 * aggregate input — and requires "the middleware admitted it" to equal "the
 * field is in `getQueryableFields`". The published answer and the engine's two
 * query guards come from one derivation; this is what keeps them one.
 *
 * The second block pins the answers the contract names, above all the one that
 * makes this method necessary: a field the caller is served MASKED is in the
 * read projection and NOT in the query one.
 *
 * Harness mirrors `get-writable-fields.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true };

/**
 * The baseline every authenticated caller resolves: reads the object, and two
 * fields not at all — one of them declares a masking rule, which never widens
 * an explicit deny.
 */
const MEMBER_SET = {
  name: 'member_default',
  label: 'Reader',
  objects: { ledger: CRUD },
  fields: {
    'ledger.secret': { readable: false, editable: false },
    'ledger.denied_masked': { readable: false, editable: false },
  },
} as unknown as PermissionSet;

/** The same grant plus the capability that lifts `gated_masked`'s rule. */
const UNMASK_SET = {
  ...(MEMBER_SET as object),
  label: 'Reader who may see the gated field unmasked',
  systemPermissions: ['view_gated'],
} as unknown as PermissionSet;

/** An agent's own set, holding the capability: the D10 case turns on the intersection alone. */
const AGENT_SET = {
  name: 'agent_reader',
  label: 'Agent',
  objects: { ledger: CRUD },
  systemPermissions: ['view_gated'],
} as unknown as PermissionSet;

const SCHEMAS: Record<string, unknown> = {
  ledger: {
    name: 'ledger',
    fields: {
      title: { type: 'text', label: 'Title' },
      // Masked unless the caller holds `view_gated` (the rule's unmask gate).
      gated_masked: { type: 'text', label: 'Gated', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: ['view_gated'] },
      // A rule with no gate: masked for every non-system caller.
      always_masked: { type: 'text', label: 'Always', maskingRule: 'name' },
      secret: { type: 'text', label: 'Secret' },
      denied_masked: { type: 'text', label: 'Denied', maskingRule: 'name' },
    },
  },
};
/** The field universe the plugin resolves: the schema's fields plus `id`. */
const FIELDS = ['id', 'title', 'gated_masked', 'always_masked', 'secret', 'denied_masked'];

const MEMBER_CTX = { userId: 'u_member', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };
const LIVE_DELEGATOR = 'u_boss';
const AGENT_CTX = { userId: 'u_agent', tenantId: 'org-1', positions: [], permissions: ['agent_reader'], posture: 'MEMBER' };
const DELEGATED_AGENT_CTX = { ...AGENT_CTX, onBehalfOf: { userId: LIVE_DELEGATOR } };

async function boot(sets: PermissionSet[], opts: { noBaseline?: boolean } = {}) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      findOne: vi.fn(async (_object: string, query: any) =>
        (query?.where?.id === LIVE_DELEGATOR ? { id: LIVE_DELEGATOR, email: 'boss@example.test' } : null)),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => sets,
    },
  };
  const registerService = vi.fn();
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin(
    opts.noBaseline
      ? { defaultPermissionSets: [], fallbackPermissionSet: null }
      : { fallbackPermissionSet: 'member_default' },
  );
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  return { plugin, middleware: middlewares[0], registerService };
}

/** Each way a query can name one field: the four positions the engine's two query guards judge. */
const PROBES: ReadonlyArray<readonly [string, 'find' | 'aggregate', (field: string) => Record<string, unknown>]> = [
  ['a filter', 'find', (field) => ({ where: { [field]: 'v' } })],
  ['a sort key', 'find', (field) => ({ where: {}, orderBy: [{ field, order: 'asc' }] })],
  ['a group key', 'aggregate', (field) => ({ groupBy: [field], aggregations: [{ function: 'count', alias: 'n' }] })],
  ['an aggregate input', 'aggregate', (field) => ({ aggregations: [{ function: 'max', field, alias: 'm' }] })],
];

async function middlewareAdmits(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  operation: 'find' | 'aggregate',
  context: Record<string, unknown>,
  ast: Record<string, unknown>,
): Promise<{ admitted: true } | { admitted: false; code?: unknown; status?: unknown }> {
  try {
    await middleware({ object: 'ledger', operation, context: { ...context }, options: {}, ast }, async () => {});
    return { admitted: true };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown };
    return { admitted: false, code: err.code, status: err.status ?? err.statusCode };
  }
}

describe('[#20935] getQueryableFields agrees with the middleware\'s query guards, field for field', () => {
  const CASES: Array<{ label: string; sets: PermissionSet[]; context: Record<string, unknown>; queryable: string[] }> = [
    { label: 'a member: two fields served masked, two hidden', sets: [MEMBER_SET], context: MEMBER_CTX, queryable: ['id', 'title'] },
    { label: 'a member holding the capability that lifts one rule', sets: [UNMASK_SET], context: MEMBER_CTX, queryable: ['id', 'title', 'gated_masked'] },
    { label: 'an agent holding that capability, acting for nobody', sets: [AGENT_SET, MEMBER_SET], context: AGENT_CTX, queryable: ['id', 'title', 'gated_masked'] },
    { label: 'the same agent acting for a delegator who does not hold it', sets: [AGENT_SET, MEMBER_SET], context: DELEGATED_AGENT_CTX, queryable: ['id', 'title'] },
  ];

  for (const c of CASES) {
    it(c.label, async () => {
      const { plugin, middleware } = await boot(c.sets);
      const queryable = await plugin.getQueryableFields('ledger', c.context);
      // The expected list keeps each case honest about what it exercises; the
      // equivalence below is the pin.
      expect(queryable).toEqual(c.queryable);
      for (const field of FIELDS) {
        for (const [position, operation, ast] of PROBES) {
          const verdict = await middlewareAdmits(middleware, operation, c.context, ast(field));
          if (queryable!.includes(field)) {
            expect(verdict, `${field} as ${position}`).toEqual({ admitted: true });
          } else {
            expect(verdict, `${field} as ${position}`).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403 });
          }
        }
      }
    });
  }
});

describe('[#20935] getQueryableFields — the answers the contract names', () => {
  it('a field the caller is served MASKED is readable and NOT queryable; the difference is exactly the masked fields', async () => {
    const { plugin } = await boot([MEMBER_SET]);
    const readable = await plugin.getReadableFields('ledger', MEMBER_CTX);
    const queryable = await plugin.getQueryableFields('ledger', MEMBER_CTX);
    expect(readable).toEqual(['id', 'title', 'gated_masked', 'always_masked']);
    expect(queryable).toEqual(['id', 'title']);
    expect(queryable!.every((f) => readable!.includes(f))).toBe(true);
    expect(readable!.filter((f) => !queryable!.includes(f))).toEqual(['gated_masked', 'always_masked']);
  });

  it('a system context bypasses: the full field set', async () => {
    const { plugin } = await boot([MEMBER_SET]);
    expect(await plugin.getQueryableFields('ledger', { isSystem: true })).toEqual(FIELDS);
  });

  it('no permission sets resolved: every field but the masked ones — a caller holding nothing lifts no rule (#20995)', async () => {
    const { plugin } = await boot([], { noBaseline: true });
    // `denied_masked`'s explicit deny comes from a set this caller does not
    // resolve, so here it is simply a field whose rule applies.
    expect(await plugin.getQueryableFields('ledger', MEMBER_CTX)).toEqual(['id', 'title', 'secret']);
  });

  it('an unresolvable object is no answer (undefined), not an empty one', async () => {
    const { plugin } = await boot([MEMBER_SET]);
    expect(await plugin.getQueryableFields('no_such_object', MEMBER_CTX)).toBeUndefined();
  });

  it('a delegator that does not exist fails closed: []', async () => {
    const { plugin } = await boot([AGENT_SET, MEMBER_SET]);
    expect(await plugin.getQueryableFields('ledger', { ...AGENT_CTX, onBehalfOf: { userId: 'u_ghost' } })).toEqual([]);
  });

  it('is exposed on the registered "security" service', async () => {
    const { registerService } = await boot([MEMBER_SET]);
    const svc = registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    expect(typeof svc?.getQueryableFields).toBe('function');
    expect(await svc.getQueryableFields('ledger', MEMBER_CTX)).toEqual(['id', 'title']);
  });
});

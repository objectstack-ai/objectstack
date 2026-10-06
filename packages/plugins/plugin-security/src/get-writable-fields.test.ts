// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18386] `getWritableFields` — the write-side twin of `getReadableFields`.
 *
 * The first block is an EQUIVALENCE, not a table of expected lists: for every
 * field of the object it drives the REAL registered middleware with a write
 * whose payload names only that field, and requires "the middleware admitted
 * it" to equal "the field is in `getWritableFields`". The two answers come from
 * one derivation; this is what keeps them one.
 *
 * Harness mirrors `can-write-object-admission.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true };

/** The baseline every authenticated caller resolves: reads `account`, may not edit it; `secret` neither. */
const LOCKED_SET = {
  name: 'member_default',
  label: 'Writer, FLS-locked',
  objects: { invoice: CRUD },
  fields: {
    'invoice.account': { readable: true, editable: false },
    'invoice.secret': { readable: false, editable: false },
  },
} as unknown as PermissionSet;

/** The same grant with no field rules — every field passes step 2.5. */
const OPEN_SET = { name: 'member_default', label: 'Writer', objects: { invoice: CRUD } } as unknown as PermissionSet;

/** …and with the capability `margin` requires (ADR-0066 D3). */
const CAPABLE_SET = {
  name: 'member_default',
  label: 'Writer with the margin capability',
  objects: { invoice: CRUD },
  systemPermissions: ['view_margin'],
} as unknown as PermissionSet;

/** An agent's own set, which may edit `account`: the D10 case turns on the intersection alone. */
const AGENT_SET = {
  name: 'agent_writer',
  label: 'Agent',
  objects: { invoice: CRUD },
  fields: { 'invoice.account': { readable: true, editable: true } },
} as unknown as PermissionSet;

const SCHEMAS: Record<string, unknown> = {
  invoice: {
    name: 'invoice',
    fields: {
      title: { type: 'text', label: 'Title' },
      account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
      secret: { type: 'text', label: 'Secret' },
      margin: { type: 'number', label: 'Margin', requiredPermissions: ['view_margin'] },
    },
  },
};
/** The field universe the plugin resolves: the schema's fields plus `id`. */
const FIELDS = ['id', 'title', 'account', 'secret', 'margin'];
const PAYLOAD_VALUE: Record<string, unknown> = { id: 'inv_1', title: 'x', account: 'acc_1', secret: 's', margin: 1 };

const WRITER_CTX = { userId: 'u_writer', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };
const LIVE_DELEGATOR = 'u_boss';
const AGENT_CTX = { userId: 'u_agent', tenantId: 'org-1', positions: [], permissions: ['agent_writer'], posture: 'MEMBER' };
const DELEGATED_AGENT_CTX = { ...AGENT_CTX, onBehalfOf: { userId: LIVE_DELEGATOR } };

async function boot(sets: PermissionSet[], opts: { noBaseline?: boolean } = {}) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      findOne: vi.fn(async (_object: string, query: any) =>
        (query?.where?.id === LIVE_DELEGATOR
          ? { id: LIVE_DELEGATOR, email: 'boss@example.test' }
          // [#21771] An addressed by-id update asks the read door for its row;
          // the double holds the one row the update names.
          : query?.where?.id === PAYLOAD_VALUE.id ? { id: PAYLOAD_VALUE.id, title: 'x' } : null)),
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

async function middlewareAdmits(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  operation: 'insert' | 'update',
  context: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await middleware(
      { object: 'invoice', operation, context: { ...context }, options: {}, ast: { where: {} }, data },
      async () => {},
    );
    return true;
  } catch {
    return false;
  }
}

describe('getWritableFields agrees with the middleware\'s write gate, field for field', () => {
  const CASES: Array<{ label: string; sets: PermissionSet[]; context: Record<string, unknown>; writable: string[] }> = [
    { label: 'a field read but not editable, and one neither', sets: [LOCKED_SET], context: WRITER_CTX, writable: ['id', 'title'] },
    { label: 'no field rules', sets: [OPEN_SET], context: WRITER_CTX, writable: ['id', 'title', 'account', 'secret'] },
    { label: 'the field capability held', sets: [CAPABLE_SET], context: WRITER_CTX, writable: FIELDS },
    { label: 'a delegated agent whose delegator may not edit the field', sets: [AGENT_SET, LOCKED_SET], context: DELEGATED_AGENT_CTX, writable: ['id', 'title'] },
    { label: 'the same agent acting for nobody', sets: [AGENT_SET, LOCKED_SET], context: AGENT_CTX, writable: ['id', 'title', 'account'] },
  ];

  for (const c of CASES) {
    it(c.label, async () => {
      const { plugin, middleware } = await boot(c.sets);
      const writable = await plugin.getWritableFields('invoice', c.context);
      // The expected list keeps each case honest about what it exercises; the
      // equivalence below is the pin.
      expect(writable).toEqual(c.writable);
      for (const operation of ['insert', 'update'] as const) {
        for (const field of FIELDS) {
          const admitted = await middlewareAdmits(middleware, operation, c.context, { [field]: PAYLOAD_VALUE[field] });
          expect(admitted, `${operation} naming ${field}`).toBe(writable!.includes(field));
        }
      }
    });
  }
});

describe('getWritableFields — the answers the contract names', () => {
  it('a field the caller may read but not edit is readable and NOT writable', async () => {
    const { plugin } = await boot([LOCKED_SET]);
    expect(await plugin.getReadableFields('invoice', WRITER_CTX)).toContain('account');
    expect(await plugin.getWritableFields('invoice', WRITER_CTX)).not.toContain('account');
  });

  it('a system context bypasses: the full field set', async () => {
    const { plugin } = await boot([LOCKED_SET]);
    expect(await plugin.getWritableFields('invoice', { isSystem: true })).toEqual(FIELDS);
  });

  it('no permission sets resolved: the full field set minus the capability-gated field — a field answer, while [#21079] the write itself is refused at object admission', async () => {
    const { plugin, middleware } = await boot([], { noBaseline: true });
    // [#21063] The caller holds no capability, so `margin`'s
    // `requiredPermissions` is the one field the field layer refuses it.
    expect(await plugin.getWritableFields('invoice', WRITER_CTX)).toEqual(FIELDS.filter((f) => f !== 'margin'));
    // [#21079] The answer is field-level only, as the contract states: this
    // caller carries a principal and resolves no set, so the ADR-0056 D2 deny
    // baseline refuses every write at the CRUD gate, whatever field it names.
    for (const field of ['margin', 'secret']) {
      const refusal = await middleware(
        { object: 'invoice', operation: 'update', context: { ...WRITER_CTX }, options: {}, ast: { where: {} }, data: { [field]: PAYLOAD_VALUE[field] } },
        async () => {},
      ).then(
        () => null,
        (e: { code?: unknown; status?: unknown; statusCode?: unknown }) => ({ code: e.code, status: e.status ?? e.statusCode }),
      );
      expect(refusal, `update naming ${field}`).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    }
  });

  it('an unresolvable object is no answer (undefined), not an empty one', async () => {
    const { plugin } = await boot([LOCKED_SET]);
    expect(await plugin.getWritableFields('no_such_object', WRITER_CTX)).toBeUndefined();
  });

  it('a delegator that does not exist fails closed: []', async () => {
    const { plugin } = await boot([AGENT_SET, LOCKED_SET]);
    expect(await plugin.getWritableFields('invoice', { ...AGENT_CTX, onBehalfOf: { userId: 'u_ghost' } })).toEqual([]);
  });

  it('is exposed on the registered "security" service', async () => {
    const { registerService } = await boot([LOCKED_SET]);
    const svc = registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    expect(typeof svc?.getWritableFields).toBe('function');
    expect(await svc.getWritableFields('invoice', WRITER_CTX)).toEqual(['id', 'title']);
  });
});

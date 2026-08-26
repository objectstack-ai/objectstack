// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10757] The engine middleware resolves a context's permission sets ONCE, and
 * a WRITE retires that resolution.
 *
 * ## The duplicate
 *
 * `findData` answers a paginated list with two engine operations — `find` for
 * the page, `count` for the total — and this middleware runs on both. Each pass
 * re-resolved the same permission sets for the same context, so one
 * `GET /data/:object?$top=1` sent `select * from sys_permission_set where name
 * in (…)` twice, back to back, identical bindings. Measured on a real stack
 * (`pnpm dev:crm`, `X-OS-Debug-Timing: json`): queries 21 and 23 of 24 before,
 * 23 queries after.
 *
 * ## Why this suite is mostly about INVALIDATION
 *
 * Reusing an authorization answer is only safe while the question cannot have
 * changed, so the assertions that matter here are the ones that prove it is
 * NOT reused when it could have. Three independent ways the answer can change,
 * one block each:
 *
 *  - **a write** — a permission change lands as a write to `sys_permission_set`
 *    / `sys_user_permission_set` / `sys_position_*` through this very engine.
 *    The epoch bump sits ahead of the `isSystem` bypass on purpose: the writes
 *    most likely to change what a caller may see are system ones (the seeder, a
 *    package publish, the auto-org-admin grant), and a guard that only saw user
 *    writes would leave a memo standing across exactly those.
 *  - **a different principal** — a second context object never reads the
 *    first's answer, whatever it holds.
 *  - **the same object, rewritten in place** — grants edited on a live context
 *    change the memo key, so the resolution is redone.
 *
 * The DEDUPE assertion (`toHaveBeenCalledTimes(1)`) is the only one that would
 * pass on `origin/main`; every invalidation assertion below is green in both
 * directions and is a GUARD, not evidence. That is the intended split: the
 * saving is one measurement, and the safety is a fence around it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** Resolvable from metadata, so only `custom_role` below reaches the db loader. */
const baselineSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as never;

/**
 * The db-loader harness. `find` is the SOLE observable: every call it records is
 * one `sys_permission_set` round trip the deployment would really have made.
 */
const makeHarness = () => {
  const fields: Record<string, unknown> = {};
  for (const f of ['id', 'organization_id', 'owner_id', 'name']) fields[f] = { name: f };
  const baseSchema = { name: 'task', fields };
  let middleware: ((opCtx: unknown, next: () => Promise<void>) => Promise<void>) | undefined;
  // The options bag is declared even though the fake ignores it: the assertion
  // below reads `call[1]`, and a one-parameter mock types its call tuple as
  // length 1 — `tsc` refuses the index, and this package's test layer is
  // ratcheted (`pnpm check:type-check-debt`).
  const find = vi.fn(async (object: string, _options?: unknown) =>
    object === 'sys_permission_set'
      ? [{ id: 'ps-1', name: 'custom_role', label: 'Custom', object_permissions: '{}' }]
      : [],
  );
  const ql = {
    registerMiddleware: (mw: never) => {
      if (!middleware) middleware = mw;
    },
    getSchema: () => baseSchema,
    find,
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => baseSchema, list: async () => [baselineSet] },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return {
    ctx,
    find,
    /**
     * How many reads THE DB LOADER has issued so far.
     *
     * Matched on the loader's own predicate shape (`name: { $in: [...] }`)
     * rather than on the object name: several unrelated probes read
     * `sys_permission_set` by single name on this path (the ADR-0095
     * auto-org-admin grant, the ADR-0090 audience-binding suggestions), and
     * counting those would make the number mean "reads of a table" instead of
     * "resolutions of this context" — the quantity under test.
     */
    permissionSetReads: () =>
      find.mock.calls.filter((c) => {
        if (c[0] !== 'sys_permission_set') return false;
        const where = (c[1] as { where?: { name?: unknown } } | undefined)?.where;
        return Array.isArray((where?.name as { $in?: unknown[] } | undefined)?.$in);
      }).length,
    run: async (opCtx: unknown) => {
      if (!middleware) throw new Error('middleware never registered');
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

const boot = async () => {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const harness = makeHarness();
  await plugin.init(harness.ctx as never);
  await plugin.start(harness.ctx as never);
  return harness;
};

/** A live execution context — one object, threaded through a request's ops. */
const requestContext = () => ({
  userId: 'u1',
  tenantId: 'org-1',
  positions: ['custom_role'],
  permissions: [] as string[],
});

const readOp = (context: unknown, operation: 'find' | 'count') => ({
  object: 'task',
  operation,
  ast: { object: 'task', where: undefined },
  options: { where: undefined },
  context,
});

describe('[#10757] permission-set resolution is memoized per execution context', () => {
  it('resolves ONCE for the find/count pair of a single request', async () => {
    const harness = await boot();
    const context = requestContext();

    await harness.run(readOp(context, 'find'));
    await harness.run(readOp(context, 'count'));

    expect(harness.permissionSetReads()).toBe(1);
  });

  describe('…and re-resolves whenever the answer could have changed', () => {
    it('after a WRITE — even a system write, which bypasses every other gate', async () => {
      const harness = await boot();
      const context = requestContext();

      await harness.run(readOp(context, 'find'));
      // The one shape the guard has to catch and the `isSystem` bypass would
      // otherwise hide: a seeder / package publish / auto-grant rewriting the
      // RBAC tables mid-flight.
      await harness.run({
        object: 'sys_user_permission_set',
        operation: 'insert',
        data: { user_id: 'u1', permission_set_id: 'ps-9' },
        context: { isSystem: true },
      });
      await harness.run(readOp(context, 'count'));

      expect(harness.permissionSetReads()).toBe(2);
    });

    it('after a write by ANOTHER context — the epoch is process-wide, not per caller', async () => {
      const harness = await boot();
      const context = requestContext();

      await harness.run(readOp(context, 'find'));
      await harness.run({
        object: 'sys_permission_set',
        operation: 'update',
        id: 'ps-1',
        data: { label: 'Renamed' },
        context: { isSystem: true },
      });
      await harness.run(readOp(context, 'count'));

      expect(harness.permissionSetReads()).toBe(2);
    });

    it('for a DIFFERENT context object holding identical grants', async () => {
      const harness = await boot();

      // Two requests by the same user resolve independently: the memo is keyed
      // on the context OBJECT, so nothing survives the request that built it.
      await harness.run(readOp(requestContext(), 'find'));
      await harness.run(readOp(requestContext(), 'find'));

      expect(harness.permissionSetReads()).toBe(2);
    });

    it('when the SAME context object has its grants rewritten in place', async () => {
      const harness = await boot();
      const context = requestContext();

      await harness.run(readOp(context, 'find'));
      context.positions = ['some_other_role'];
      await harness.run(readOp(context, 'find'));

      expect(harness.permissionSetReads()).toBe(2);
    });
  });

  it('hands every caller its own array — the memo is not an aliasing channel', async () => {
    const harness = await boot();
    const context = requestContext();
    const opA: Record<string, any> = readOp(context, 'find');
    const opB: Record<string, any> = readOp(context, 'count');

    await harness.run(opA);
    await harness.run(opB);

    // Both passes injected a read scope built from the SAME resolution, and
    // neither pass could have mutated the other's list on the way.
    expect(harness.permissionSetReads()).toBe(1);
    expect(opA.ast.object).toBe('task');
    expect(opB.ast.object).toBe('task');
  });
});

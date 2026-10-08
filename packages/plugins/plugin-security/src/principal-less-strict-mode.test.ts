// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21908] ADR-0096 D5 STRICT MODE — a context that carries no principal and is
 * not a system one is REFUSED, at every layer that used to hand it through.
 *
 * The published contract sentence (`ChatWithToolsOptions.toolExecutionContext`)
 * says an empty context runs "unauthenticated (RLS-on, sees-nothing)". The
 * engine middleware used to hand such a context straight to `next()` — no CRUD
 * gate, no RLS, no FLS mask, no tenant Layer 0 — and the object-admission
 * probes and the row scope agreed with the hand-off. Now:
 *
 *  - the middleware refuses EVERY engine operation with `PermissionDeniedError`
 *    (`PERMISSION_DENIED` / 403) before the operation runs;
 *  - `canReadObject` / `canExport` / `canWriteObject` answer `false`;
 *  - `getReadFilter` answers the deny sentinel (zero rows).
 *
 * The class is pinned by every spelling a producer hands the engine: no context
 * at all, an empty one, empty principal arrays, an explicit `isSystem: false`,
 * a tenant id alone, and a provenance-only context. None of them is a
 * principal.
 *
 * The two routes that remain are explicit, and both are pinned unchanged: an
 * explicit system context (`isSystem: true`, with or without a principal) is
 * admitted everywhere, and a context that carries a principal without a user id
 * (a named permission set, the guest position, the public-form grant) is decided
 * by what it carries — the deny is keyed on carrying NO principal, never on the
 * absence of a user id.
 *
 * Fixtures are synthetic. Harness mirrors `zero-set-deny-baseline.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const SCHEMAS: Record<string, unknown> = {
  ledger: { name: 'ledger', fields: { title: { type: 'text', label: 'Title' } } },
};

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true };

/** The member baseline grants the object outright, so a refusal below is never a missing grant. */
const MEMBER_SET = { name: 'member_default', label: 'Synthetic member', objects: { ledger: CRUD } } as unknown as PermissionSet;
/** A set a user-less context can name, registered by the deployment. */
const NAMED_SET = { name: 'synth_named', label: 'Synthetic named set', objects: { ledger: CRUD } } as unknown as PermissionSet;
/** What a deployment binds its guest audience to. */
const GUEST_SET = { name: 'synth_guest', label: 'Synthetic guest set', objects: { ledger: CRUD } } as unknown as PermissionSet;

async function boot() {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const registered: Record<string, any> = {};
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      findOne: vi.fn(async () => null),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => [MEMBER_SET, NAMED_SET, GUEST_SET],
    },
  };
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  const security = registered['security'] as {
    canReadObject(object: string, context?: unknown): Promise<boolean>;
    canExport(object: string, context?: unknown): Promise<boolean>;
    getReadFilter(object: string, context?: unknown): Promise<Record<string, unknown> | undefined>;
  };
  return { plugin, middleware: middlewares[0], security };
}

type Verdict = { admitted: true } | { admitted: false; ran: boolean; code?: unknown; status?: unknown };

/** Drive the registered middleware; `ran` says whether the operation itself was reached. */
async function run(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  operation: string,
  context: Record<string, unknown> | undefined,
): Promise<Verdict> {
  let ran = false;
  const opCtx: Record<string, unknown> = {
    object: 'ledger', operation, context: context === undefined ? undefined : { ...context }, options: {}, ast: { where: {} },
  };
  if (operation === 'insert' || operation === 'update') opCtx.data = { title: 'SYNTH' };
  if (operation === 'aggregate') opCtx.ast = { aggregations: [{ function: 'count', alias: 'n' }] };
  try {
    await middleware(opCtx, async () => { ran = true; });
    return { admitted: true };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown };
    return { admitted: false, ran, code: err.code, status: err.status ?? err.statusCode };
  }
}

/** Every probe a door that bypasses the middleware asks, on the one object. */
async function probes(booted: Awaited<ReturnType<typeof boot>>, context: Record<string, unknown> | undefined) {
  const { plugin, security } = booted;
  const c = () => (context === undefined ? undefined : { ...context });
  return {
    canReadObject: await security.canReadObject('ledger', c()),
    canExport: await security.canExport('ledger', c()),
    canInsert: await plugin.canWriteObject('ledger', 'insert', c()),
    canInsertPayload: await plugin.canWriteObject('ledger', 'insert', c(), { title: 'SYNTH' }),
    canUpdatePayload: await plugin.canWriteObject('ledger', 'update', c(), { title: 'SYNTH' }),
  };
}

const REFUSED_BEFORE_IT_RUNS = { admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 } as const;
const ALL_FALSE = { canReadObject: false, canExport: false, canInsert: false, canInsertPayload: false, canUpdatePayload: false };
const ALL_TRUE = { canReadObject: true, canExport: true, canInsert: true, canInsertPayload: true, canUpdatePayload: true };
const READS = ['find', 'findOne', 'count', 'aggregate'] as const;
const WRITES = ['insert', 'update', 'delete'] as const;

/** Every spelling of "no principal" a producer hands the engine. */
const PRINCIPAL_LESS: Array<{ label: string; context: Record<string, unknown> | undefined }> = [
  { label: 'no context at all', context: undefined },
  { label: 'an empty context', context: {} },
  { label: 'empty principal arrays', context: { positions: [], permissions: [] } },
  { label: 'an explicit isSystem: false', context: { isSystem: false } },
  { label: 'a tenant id alone', context: { tenantId: 'org-1' } },
  { label: 'a provenance-only context', context: { runId: 'run_synth', source: 'synth' } },
];

describe('[#21908] a principal-less, non-system context is refused on read and write (ADR-0096 D5)', () => {
  for (const c of PRINCIPAL_LESS) {
    describe(c.label, () => {
      it('the middleware refuses every read before it runs: PERMISSION_DENIED / 403', async () => {
        const { middleware } = await boot();
        for (const operation of READS) {
          expect(await run(middleware, operation, c.context), operation).toEqual(REFUSED_BEFORE_IT_RUNS);
        }
      });

      it('the middleware refuses every write before it runs: PERMISSION_DENIED / 403', async () => {
        const { middleware } = await boot();
        for (const operation of WRITES) {
          expect(await run(middleware, operation, c.context), operation).toEqual(REFUSED_BEFORE_IT_RUNS);
        }
      });

      it('the object-admission probes answer no, and the row scope is the deny sentinel', async () => {
        const booted = await boot();
        expect(await probes(booted, c.context)).toEqual(ALL_FALSE);
        expect(await booted.security.getReadFilter('ledger', c.context === undefined ? undefined : { ...c.context }))
          .toEqual({ ...RLS_DENY_FILTER });
      });
    });
  }
});

describe('[#21908] an explicit system context is unchanged', () => {
  for (const context of [{ isSystem: true }, { isSystem: true, userId: 'usr_system' }]) {
    it(`${JSON.stringify(context)}: every operation runs, the probes admit, and no row scope applies`, async () => {
      const booted = await boot();
      for (const operation of [...READS, ...WRITES]) {
        expect(await run(booted.middleware, operation, context), operation).toEqual({ admitted: true });
      }
      expect(await probes(booted, context)).toEqual(ALL_TRUE);
      expect(await booted.security.getReadFilter('ledger', { ...context })).toBeUndefined();
    });
  }
});

describe('[#21908] the deny is keyed on carrying NO principal, never on the absence of a user id', () => {
  it('a user-less context naming a registered set is decided by that set', async () => {
    const booted = await boot();
    const named = { permissions: ['synth_named'], anonymous: true };
    expect(await run(booted.middleware, 'find', named)).toEqual({ admitted: true });
    expect(await run(booted.middleware, 'insert', named)).toEqual({ admitted: true });
    expect(await booted.security.canReadObject('ledger', { ...named })).toBe(true);
  });

  it('the guest principal is decided by the set its deployment binds to it', async () => {
    const booted = await boot();
    const guest = { positions: ['guest'], permissions: ['synth_guest'], principalKind: 'guest', isSystem: false };
    expect(await run(booted.middleware, 'find', guest)).toEqual({ admitted: true });
    expect(await booted.security.canReadObject('ledger', { ...guest })).toBe(true);
  });

  it('the public-form grant admits its declared create on its declared object, and nothing else', async () => {
    const booted = await boot();
    const grant = { publicFormGrant: { object: 'ledger' }, permissions: ['synth_named'], anonymous: true };
    expect(await run(booted.middleware, 'insert', grant)).toEqual({ admitted: true });
    expect(await run(booted.middleware, 'delete', grant)).toMatchObject({ admitted: false, ran: false, code: 'PERMISSION_DENIED' });
  });

  it('CONTROL: a signed-in member is admitted to what its set grants', async () => {
    const booted = await boot();
    const member = { userId: 'u_member', tenantId: 'org-1', positions: [], permissions: [] };
    for (const operation of [...READS, ...WRITES]) {
      expect(await run(booted.middleware, operation, member), operation).toEqual({ admitted: true });
    }
    expect(await probes(booted, member)).toEqual(ALL_TRUE);
  });
});

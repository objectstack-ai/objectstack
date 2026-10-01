// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21079] ADR-0056 D2 — an empty permission-set list is the DENY BASELINE.
 *
 * A non-system caller that carries a principal (a position, a named permission
 * set or a user id) and resolves NO permission set used to be admitted to every
 * object no set grants, and read with the sharing predicate as its only row
 * scope: the middleware's CRUD gate, and the `canReadObject` / `canWriteObject`
 * / `canExport` probes beside it, each stood down on an empty list, and
 * `getReadFilter` composed a scope that never said "deny". ADR-0056 D2 says an
 * unauthenticated principal gets the deny baseline, not "no checks"; ADR-0090
 * D9 says a guest holds the `guest` position and nothing else.
 *
 * The caller class is pinned per measured member, each by what resolution
 * answers for it rather than by a door, and each case first asserts that
 * premise (zero sets resolved), so a later change to resolution moves the case
 * out of the class loudly instead of silently testing something else:
 *
 *  - the guest envelope (the `guest` audience anchor, which no set is named
 *    after) on a deployment that registers no guest set;
 *  - a context that names only a permission set the deployment does not
 *    register, with no user id (the shape the public-form lookup picker hands
 *    the engine on a deployment without that set);
 *  - a signed-in user on an embedder that switches the baseline off
 *    (`fallbackPermissionSet: null`) and grants that user nothing.
 *
 * For each, ONE answer at every layer: object admission refuses it — the
 * middleware with `PERMISSION_DENIED` / 403 for every engine operation, before
 * the operation runs, and the three probes `false` — and its row scope is the
 * deny sentinel.
 *
 * Controls: a signed-in member who resolves a set is admitted to the object the
 * set grants (and refused the one it does not), and a deployment that
 * registers the named set is decided by that set. The boundary: a
 * principal-less context (no position, no named set, no user id) is handed
 * through exactly as before (ADR-0096 stages it separately).
 *
 * And the same answer for the second principal of a delegated request: an
 * agent acting for a delegator who resolves no set is refused by the probes as
 * the middleware refuses it, with a delegator who resolves a set as the control.
 *
 * Fixtures are synthetic. Harness mirrors `zero-set-masking.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const SCHEMAS: Record<string, unknown> = {
  ledger: { name: 'ledger', fields: { title: { type: 'text', label: 'Title' } } },
  granted: { name: 'granted', fields: { title: { type: 'text', label: 'Title' } } },
};

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true };

/** The member baseline: one object granted, the other not. */
const MEMBER_SET = { name: 'member_default', label: 'Synthetic member', objects: { granted: CRUD } } as unknown as PermissionSet;
/** The set the picker-shaped context names, registered only on the control deployment. */
const NAMED_SET = { name: 'synth_named', label: 'Synthetic named set', objects: { ledger: CRUD } } as unknown as PermissionSet;
/** A delegated agent's own ceiling: everything on `ledger`, so the delegator's leg is what decides. */
const AGENT_SET = { name: 'synth_agent', label: 'Synthetic agent ceiling', objects: { ledger: CRUD } } as unknown as PermissionSet;
/** What the live delegator holds in the delegation control. */
const DELEGATOR_SET = { name: 'synth_delegator', label: 'Synthetic delegator', objects: { ledger: CRUD } } as unknown as PermissionSet;

const DELEGATOR_ID = 'u_delegator';

type Deployment = { sets: PermissionSet[]; noBaseline?: boolean; delegatorPermissions?: string[] };

async function boot(deployment: Deployment) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const registered: Record<string, any> = {};
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      // The delegator's user row, and nothing else: the delegator's grants come
      // from the deployment's sets, or from no set at all.
      findOne: vi.fn(async (object: string, query: any) => {
        assertEngineFindOnePredicate(object, query);
        return object === 'sys_user' && query?.where?.id === DELEGATOR_ID ? { id: DELEGATOR_ID, email: 'delegator@synth.test' } : null;
      }),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => deployment.sets,
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
  const plugin = new SecurityPlugin(
    deployment.noBaseline
      ? { defaultPermissionSets: [], fallbackPermissionSet: null }
      : { fallbackPermissionSet: 'member_default' },
  );
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
  object: string,
  operation: string,
  context: Record<string, unknown>,
): Promise<Verdict> {
  let ran = false;
  const opCtx: Record<string, unknown> = { object, operation, context: { ...context }, options: {}, ast: { where: {} } };
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

const REFUSED_AT_ADMISSION = { admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 } as const;
const ENGINE_OPERATIONS = ['find', 'findOne', 'count', 'aggregate', 'insert', 'update', 'delete'] as const;

/** Every probe this caller class is answered by, on one object. */
async function probes(
  booted: Awaited<ReturnType<typeof boot>>,
  object: string,
  context: Record<string, unknown>,
) {
  const { plugin, security } = booted;
  return {
    canReadObject: await security.canReadObject(object, { ...context }),
    canExport: await security.canExport(object, { ...context }),
    canInsert: await plugin.canWriteObject(object, 'insert', { ...context }),
    canInsertPayload: await plugin.canWriteObject(object, 'insert', { ...context }, { title: 'SYNTH' }),
    canUpdatePayload: await plugin.canWriteObject(object, 'update', { ...context }, { title: 'SYNTH' }),
  };
}

const ALL_FALSE = { canReadObject: false, canExport: false, canInsert: false, canInsertPayload: false, canUpdatePayload: false };
const ALL_TRUE = { canReadObject: true, canExport: true, canInsert: true, canInsertPayload: true, canUpdatePayload: true };

/** The measured members of the class, each on the deployment that produces it. */
const ZERO_SET_CASES: Array<{ label: string; deployment: Deployment; context: Record<string, unknown> }> = [
  {
    label: 'the guest envelope, on a deployment that registers no guest set',
    deployment: { sets: [MEMBER_SET] },
    context: { positions: ['guest'], permissions: [], principalKind: 'guest', isSystem: false },
  },
  {
    label: 'a context naming only a set the deployment does not register, with no user id',
    deployment: { sets: [MEMBER_SET] },
    context: { permissions: ['synth_named'], anonymous: true },
  },
  {
    label: 'a signed-in user granted nothing, on an embedder that switches the baseline off',
    deployment: { sets: [], noBaseline: true },
    context: { userId: 'u_synth', tenantId: 'org-1', positions: [], permissions: [] },
  },
];

describe('[#21079] a non-system caller that carries a principal and resolves no permission set gets the deny baseline', () => {
  for (const c of ZERO_SET_CASES) {
    describe(c.label, () => {
      it('premise: resolution answers no permission set for this caller', async () => {
        const { plugin } = await boot(c.deployment);
        await expect((plugin as any).resolvePermissionSetsForContext({ ...c.context })).resolves.toEqual([]);
      });

      it('the middleware refuses every engine operation at object admission, before it runs', async () => {
        const { middleware } = await boot(c.deployment);
        for (const operation of ENGINE_OPERATIONS) {
          expect(await run(middleware, 'ledger', operation, c.context), operation).toEqual(REFUSED_AT_ADMISSION);
        }
      });

      it('the object-admission probes answer no, as the middleware does', async () => {
        const booted = await boot(c.deployment);
        expect(await probes(booted, 'ledger', c.context)).toEqual(ALL_FALSE);
      });

      it('the row scope is the deny sentinel', async () => {
        const { security } = await boot(c.deployment);
        expect(await security.getReadFilter('ledger', { ...c.context })).toEqual({ ...RLS_DENY_FILTER });
      });
    });
  }
});

describe('[#21079] the controls: a caller who resolves a set is decided by that set', () => {
  const MEMBER = { userId: 'u_member', tenantId: 'org-1', positions: [], permissions: [] };

  it('a signed-in member is admitted to the object its set grants, with no deny scope', async () => {
    const booted = await boot({ sets: [MEMBER_SET] });
    await expect((booted.plugin as any).resolvePermissionSetsForContext({ ...MEMBER })).resolves.toHaveLength(1);
    for (const operation of ENGINE_OPERATIONS) {
      expect(await run(booted.middleware, 'granted', operation, MEMBER), operation).toEqual({ admitted: true });
    }
    expect(await probes(booted, 'granted', MEMBER)).toEqual(ALL_TRUE);
    expect(await booted.security.getReadFilter('granted', { ...MEMBER })).not.toEqual({ ...RLS_DENY_FILTER });
  });

  it('…and refused the object its set does not grant, so the control is not "admit everything"', async () => {
    const booted = await boot({ sets: [MEMBER_SET] });
    expect(await run(booted.middleware, 'ledger', 'find', MEMBER)).toEqual(REFUSED_AT_ADMISSION);
    expect(await probes(booted, 'ledger', MEMBER)).toEqual(ALL_FALSE);
  });

  it('a deployment that registers the named set admits the same context to what that set grants', async () => {
    const NAMED = { permissions: ['synth_named'], anonymous: true };
    const booted = await boot({ sets: [MEMBER_SET, NAMED_SET] });
    await expect((booted.plugin as any).resolvePermissionSetsForContext({ ...NAMED })).resolves.toHaveLength(1);
    expect(await run(booted.middleware, 'ledger', 'find', NAMED)).toEqual({ admitted: true });
    expect(await booted.security.canReadObject('ledger', { ...NAMED })).toBe(true);
    expect(await booted.security.getReadFilter('ledger', { ...NAMED })).not.toEqual({ ...RLS_DENY_FILTER });
  });
});

describe('[#21079] the boundary: a principal-less context is handed through, unchanged (ADR-0096)', () => {
  const PRINCIPAL_LESS = { positions: [], permissions: [] };

  it('the middleware admits it, the probes admit it, and its row scope is not the deny sentinel', async () => {
    const booted = await boot({ sets: [MEMBER_SET] });
    for (const operation of ENGINE_OPERATIONS) {
      expect(await run(booted.middleware, 'ledger', operation, PRINCIPAL_LESS), operation).toEqual({ admitted: true });
    }
    expect(await probes(booted, 'ledger', PRINCIPAL_LESS)).toEqual(ALL_TRUE);
    expect(await booted.security.getReadFilter('ledger', { ...PRINCIPAL_LESS })).toBeUndefined();
  });
});

describe('[#21079] the second principal: a delegator who resolves no permission set is the deny baseline too', () => {
  const AGENT = {
    userId: 'u_agent', tenantId: 'org-1', principalKind: 'agent', positions: [], permissions: ['synth_agent'],
    onBehalfOf: { userId: DELEGATOR_ID, principalKind: 'human' },
  };

  it('on an embedder with no baseline, the delegator resolves nothing: the middleware refuses, and the probes agree', async () => {
    const booted = await boot({ sets: [AGENT_SET], noBaseline: true });
    await expect((booted.plugin as any).resolvePermissionSetsForContext({ ...AGENT })).resolves.toHaveLength(1);
    expect(await run(booted.middleware, 'ledger', 'find', AGENT)).toEqual(REFUSED_AT_ADMISSION);
    expect(await run(booted.middleware, 'ledger', 'insert', AGENT)).toEqual(REFUSED_AT_ADMISSION);
    expect(await probes(booted, 'ledger', AGENT)).toEqual(ALL_FALSE);
  });

  it('CONTROL: a delegator who resolves a set granting the object — the middleware admits, and the probes agree', async () => {
    // The delegator's baseline is the set that grants `ledger`, so the only
    // difference from the case above is what the delegator resolves.
    const DELEGATOR_BASELINE = { ...DELEGATOR_SET, name: 'member_default' } as unknown as PermissionSet;
    const booted = await boot({ sets: [AGENT_SET, DELEGATOR_BASELINE] });
    expect(await run(booted.middleware, 'ledger', 'find', AGENT)).toEqual({ admitted: true });
    expect(await run(booted.middleware, 'ledger', 'insert', AGENT)).toEqual({ admitted: true });
    expect(await probes(booted, 'ledger', AGENT)).toEqual(ALL_TRUE);
  });
});

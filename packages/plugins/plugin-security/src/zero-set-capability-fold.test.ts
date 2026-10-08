// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21063] A capability-gated field reaches a caller who resolves NO
 * permission set as what it declares: hidden on read, refused on write — and
 * [#21079] that caller, when it carries a principal, is refused the object
 * itself (the ADR-0056 D2 deny baseline), ahead of every field gate.
 *
 * `requiredPermissions` on a field declares "mask on read, deny on write;
 * AND-gate" (ADR-0066 D3). A caller who resolves no permission set holds no
 * capability, so the gate applies to it. The field here declares the gate and
 * NO masking rule, so "mask on read" is the hidden state: the key is not
 * served. The explain engine has always reported that, and the field answers
 * agree with it. The record doors refuse the object outright, which explain's
 * `object_crud` layer has always reported for this caller too.
 *
 * The caller class is pinned three ways, each by what resolution answers for
 * it rather than by a door (the three `zero-set-masking.test.ts` pins): a
 * user id on a deployment with no baseline, a context naming only sets that
 * resolve to nothing, and a context holding only an audience anchor that no
 * set is named after. Each case first asserts the premise (zero sets
 * resolved), so a later change to resolution moves the case out of the class
 * loudly instead of silently testing something else.
 *
 * For each, ONE derivation answers every reader:
 *
 *  - the record door refuses the read at object admission, and explain
 *    agrees: `object_crud` denies, `allowed` is false, and its `fls` layer
 *    still reports the field masked from responses;
 *  - `getReadableFields` and `getMetadataReadableFields` leave it out;
 *  - `getQueryableFields` leaves it out, and the middleware refuses every
 *    query at object admission before its query guards are asked;
 *  - `getWritableFields` leaves it out, and every write — naming it or not —
 *    is refused at object admission, with `canWriteObject` agreeing with the
 *    middleware field for field.
 *
 * Controls: a caller holding the capability is served the stored value and may
 * query and write the field; a caller holding a set without the capability
 * reads the same answers as before this card. The last block pins the class's
 * former boundary: a principal-less context used to be handed straight through;
 * [#21908] ADR-0096 D5 strict mode refuses it at object admission, and its
 * field answers are the zero-set ones.
 *
 * Fixtures are synthetic. Harness mirrors `zero-set-masking.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const CAPABILITY = 'synth_cap';
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true };

const SCHEMAS: Record<string, unknown> = {
  ledger: {
    name: 'ledger',
    fields: {
      title: { type: 'text', label: 'Title' },
      // The field class: a capability gate and no masking rule.
      gated: { type: 'text', label: 'Gated', requiredPermissions: [CAPABILITY] },
    },
  },
};
/** The field universe the plugin resolves: the schema's fields plus `id`. */
const FIELDS = ['id', 'title', 'gated'];
const GATED = 'gated';
const WITHOUT_GATED = FIELDS.filter((f) => f !== GATED);

const ROW = { id: 'r1', title: 'SYNTH-TITLE', gated: 'SYNTH-GATED-VALUE' };
const PAYLOAD_VALUE: Record<string, unknown> = { id: 'r1', title: 'SYNTH-NEW-TITLE', gated: 'SYNTH-NEW-GATED' };

/** Holds the capability the field requires. */
const HOLDER_SET = {
  name: 'synth_holder',
  label: 'Synthetic capability holder',
  objects: { ledger: CRUD },
  systemPermissions: [CAPABILITY],
} as unknown as PermissionSet;

/** The same grant without the capability. */
const LACKER_SET = {
  name: 'synth_lacker',
  label: 'Synthetic grant without the capability',
  objects: { ledger: CRUD },
} as unknown as PermissionSet;

async function boot(opts: { noBaseline?: boolean } = {}) {
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
      list: async () => [HOLDER_SET, LACKER_SET],
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
    opts.noBaseline ? { defaultPermissionSets: [], fallbackPermissionSet: null } : {},
  );
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  const security = registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as {
    resolvePermissionSetsForContext: (context: unknown) => Promise<PermissionSet[]>;
    explain: (request: { object: string; operation: string }, context: unknown) => Promise<{
      allowed: boolean;
      layers: Array<{ layer: string; verdict: string; detail: string }>;
    }>;
  };
  return { plugin, middleware: middlewares[0], security };
}

/** Each way a query can name one field: the four positions the engine's two query guards judge. */
const PROBES: ReadonlyArray<readonly [string, 'find' | 'aggregate', (field: string) => Record<string, unknown>]> = [
  ['a filter', 'find', (field) => ({ where: { [field]: 'v' } })],
  ['a sort key', 'find', (field) => ({ where: {}, orderBy: [{ field, order: 'asc' }] })],
  ['a group key', 'aggregate', (field) => ({ groupBy: [field], aggregations: [{ function: 'count', alias: 'n' }] })],
  ['an aggregate input', 'aggregate', (field) => ({ aggregations: [{ function: 'max', field, alias: 'm' }] })],
];

type Verdict = { admitted: true } | { admitted: false; code?: unknown; status?: unknown };

/** [#21079] The middleware's object-admission refusal: the deny baseline's answer to an empty set list. */
const REFUSED_AT_ADMISSION = { admitted: false, code: 'PERMISSION_DENIED', status: 403 } as const;

async function run(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  opCtx: Record<string, unknown>,
): Promise<Verdict> {
  try {
    await middleware(opCtx, async () => {});
    return { admitted: true };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown };
    return { admitted: false, code: err.code, status: err.status ?? err.statusCode };
  }
}

/** What the record door serves this caller for {@link ROW}: the middleware's result masker on a find. */
async function served(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  context: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const opCtx: Record<string, any> = {
    object: 'ledger', operation: 'find', context: { ...context }, options: {}, ast: { where: {} }, result: [{ ...ROW }],
  };
  expect(await run(middleware, opCtx)).toEqual({ admitted: true });
  return opCtx.result[0];
}

/** Whether explain's `fls` layer reports `field` as not served (masked from responses). */
async function explainHides(
  security: Awaited<ReturnType<typeof boot>>['security'],
  context: Record<string, unknown>,
  field: string,
): Promise<boolean> {
  const decision = await security.explain({ object: 'ledger', operation: 'read' }, { ...context });
  const fls = decision.layers.find((l) => l.layer === 'fls');
  expect(fls, 'explain reports an fls layer').toBeDefined();
  const hidden = /field\(s\) masked from responses: \[([^\]]*)\]/.exec(fls!.detail)?.[1] ?? '';
  return hidden.split(',').map((s) => s.trim()).includes(field);
}

/** The three ways a non-system caller resolves to no permission set. */
const ZERO_SET_CASES: Array<{ label: string; noBaseline?: boolean; context: Record<string, unknown> }> = [
  {
    label: 'a caller with a user id on a deployment with no baseline',
    noBaseline: true,
    context: { userId: 'u_synth', tenantId: 'org-1', positions: [], permissions: [] },
  },
  {
    label: 'a caller without a user id naming only sets that resolve to nothing',
    context: { positions: [], permissions: ['synth_unresolvable_set'] },
  },
  {
    label: 'a caller without a user id holding only an audience anchor no set is named after',
    context: { positions: ['guest'], permissions: [], principalKind: 'guest' },
  },
];

describe('[#21063] a caller who resolves no permission set is not served a capability-gated field, and may not query or write it', () => {
  for (const c of ZERO_SET_CASES) {
    describe(c.label, () => {
      it('premise: resolution answers no permission set for this caller', async () => {
        const { security } = await boot({ noBaseline: c.noBaseline });
        expect(await security.resolvePermissionSetsForContext({ ...c.context })).toEqual([]);
      });

      it('[#21079] the record door refuses the read at object admission, and explain agrees: the object denied, the field hidden', async () => {
        const { middleware, security } = await boot({ noBaseline: c.noBaseline });
        const door = await run(middleware, {
          object: 'ledger', operation: 'find', context: { ...c.context }, options: {}, ast: { where: {} },
        });
        const decision = await security.explain({ object: 'ledger', operation: 'read' }, { ...c.context });
        expect({
          door,
          explainAllowed: decision.allowed,
          explainObjectCrud: decision.layers.find((l) => l.layer === 'object_crud')?.verdict,
          explainHides: await explainHides(security, c.context, GATED),
        }).toEqual({
          door: REFUSED_AT_ADMISSION,
          explainAllowed: false,
          explainObjectCrud: 'denies',
          explainHides: true,
        });
      });

      it('the read projections leave the field out', async () => {
        const { plugin } = await boot({ noBaseline: c.noBaseline });
        expect(await plugin.getReadableFields('ledger', { ...c.context })).toEqual(WITHOUT_GATED);
        expect(await plugin.getMetadataReadableFields('ledger', { ...c.context })).toEqual(WITHOUT_GATED);
      });

      it('the query projection leaves the field out, and [#21079] the middleware refuses every query at object admission', async () => {
        const { plugin, middleware } = await boot({ noBaseline: c.noBaseline });
        expect(await plugin.getQueryableFields('ledger', { ...c.context })).toEqual(WITHOUT_GATED);
        for (const field of FIELDS) {
          for (const [position, operation, ast] of PROBES) {
            const verdict = await run(middleware, {
              object: 'ledger', operation, context: { ...c.context }, options: {}, ast: ast(field),
            });
            expect(verdict, `${field} as ${position}`).toEqual(REFUSED_AT_ADMISSION);
          }
        }
      });

      it('the write projection leaves the field out, and [#21079] every write is refused at object admission, with the write admission agreeing field for field', async () => {
        const { plugin, middleware } = await boot({ noBaseline: c.noBaseline });
        expect(await plugin.getWritableFields('ledger', { ...c.context })).toEqual(WITHOUT_GATED);
        for (const operation of ['insert', 'update'] as const) {
          for (const field of FIELDS) {
            const data = { [field]: PAYLOAD_VALUE[field] };
            const verdict = await run(middleware, {
              object: 'ledger', operation, context: { ...c.context }, options: {}, ast: { where: {} }, data,
            });
            expect(verdict, `${operation} naming ${field}`).toEqual(REFUSED_AT_ADMISSION);
            expect(
              await plugin.canWriteObject('ledger', operation, { ...c.context }, data),
              `canWriteObject: ${operation} naming ${field}`,
            ).toBe(false);
          }
        }
      });
    });
  }
});

describe('[#21063] the controls: a caller who resolves a set reads the answers the capability decides', () => {
  const HOLDER = { userId: 'u_holder', tenantId: 'org-1', positions: [], permissions: ['synth_holder'] };
  const LACKER = { userId: 'u_lacker', tenantId: 'org-1', positions: [], permissions: ['synth_lacker'] };

  it('premise: each control caller resolves exactly its own set', async () => {
    const { security } = await boot({ noBaseline: true });
    expect((await security.resolvePermissionSetsForContext({ ...HOLDER })).map((s) => s.name)).toEqual(['synth_holder']);
    expect((await security.resolvePermissionSetsForContext({ ...LACKER })).map((s) => s.name)).toEqual(['synth_lacker']);
  });

  it('a holder of the capability is served the stored value, explain reports nothing hidden, and every projection keeps the field', async () => {
    const { plugin, middleware, security } = await boot({ noBaseline: true });
    expect(await served(middleware, HOLDER)).toEqual(ROW);
    expect(await explainHides(security, HOLDER, GATED)).toBe(false);
    expect(await plugin.getReadableFields('ledger', { ...HOLDER })).toEqual(FIELDS);
    expect(await plugin.getQueryableFields('ledger', { ...HOLDER })).toEqual(FIELDS);
    expect(await plugin.getWritableFields('ledger', { ...HOLDER })).toEqual(FIELDS);
    for (const [position, operation, ast] of PROBES) {
      expect(
        await run(middleware, { object: 'ledger', operation, context: { ...HOLDER }, options: {}, ast: ast(GATED) }),
        `${GATED} as ${position}`,
      ).toEqual({ admitted: true });
    }
    for (const operation of ['insert', 'update'] as const) {
      const data = { [GATED]: PAYLOAD_VALUE[GATED] };
      expect(
        await run(middleware, { object: 'ledger', operation, context: { ...HOLDER }, options: {}, ast: { where: {} }, data }),
        `${operation} naming ${GATED}`,
      ).toEqual({ admitted: true });
      expect(await plugin.canWriteObject('ledger', operation, { ...HOLDER }, data)).toBe(true);
    }
  });

  it('a caller holding a set without the capability is not served the field, and explain agrees', async () => {
    const { plugin, middleware, security } = await boot({ noBaseline: true });
    const row = await served(middleware, LACKER);
    expect(GATED in row).toBe(false);
    expect(await explainHides(security, LACKER, GATED)).toBe(true);
    expect(await plugin.getReadableFields('ledger', { ...LACKER })).toEqual(WITHOUT_GATED);
    expect(await plugin.getQueryableFields('ledger', { ...LACKER })).toEqual(WITHOUT_GATED);
    expect(await plugin.getWritableFields('ledger', { ...LACKER })).toEqual(WITHOUT_GATED);
  });
});

describe('[#21908] the former class boundary: a principal-less context is refused at object admission (ADR-0096 D5), and the projections give it the zero-set answers', () => {
  const PRINCIPAL_LESS = { positions: [], permissions: [] };

  it('the middleware refuses the read, every query on the field and every write naming it at object admission; the write admission agrees', async () => {
    const { plugin, middleware } = await boot();
    expect(
      await run(middleware, { object: 'ledger', operation: 'find', context: { ...PRINCIPAL_LESS }, options: {}, ast: { where: {} } }),
    ).toEqual(REFUSED_AT_ADMISSION);
    for (const [position, operation, ast] of PROBES) {
      expect(
        await run(middleware, { object: 'ledger', operation, context: { ...PRINCIPAL_LESS }, options: {}, ast: ast(GATED) }),
        `${GATED} as ${position}`,
      ).toEqual(REFUSED_AT_ADMISSION);
    }
    for (const operation of ['insert', 'update'] as const) {
      const data = { [GATED]: PAYLOAD_VALUE[GATED] };
      expect(
        await run(middleware, { object: 'ledger', operation, context: { ...PRINCIPAL_LESS }, options: {}, ast: { where: {} }, data }),
        `${operation} naming ${GATED}`,
      ).toEqual(REFUSED_AT_ADMISSION);
      expect(await plugin.canWriteObject('ledger', operation, { ...PRINCIPAL_LESS }, data)).toBe(false);
    }
  });

  it('the read, query and write projections leave the capability-gated field out, as for any caller who resolves no set', async () => {
    const { plugin } = await boot();
    expect(await plugin.getReadableFields('ledger', { ...PRINCIPAL_LESS })).toEqual(WITHOUT_GATED);
    expect(await plugin.getQueryableFields('ledger', { ...PRINCIPAL_LESS })).toEqual(WITHOUT_GATED);
    expect(await plugin.getWritableFields('ledger', { ...PRINCIPAL_LESS })).toEqual(WITHOUT_GATED);
  });
});

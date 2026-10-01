// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20995] A masking rule reaches a caller who resolves NO permission set —
 * and [#21079] that caller, when it carries a principal, is refused the object
 * itself (the ADR-0056 D2 deny baseline).
 *
 * `maskingRule` declares itself for "every non-system caller unless the
 * field's `requiredPermissions` are ALL held", and "masked callers cannot
 * filter/sort/group/aggregate on the field". A caller who holds no permission
 * set holds no capability, so every rule applies to them in the FIELD answers:
 * the field is a served column that is not queryable.
 *
 * The caller class is pinned three ways, each by what resolution answers for
 * it rather than by a door: a user id on a deployment with no baseline, a
 * context naming only sets that resolve to nothing, and a context holding only
 * an audience anchor that no set is named after. Each case first asserts the
 * premise (zero sets resolved), so a later change to resolution moves the case
 * out of the class loudly instead of silently testing something else.
 *
 * For each:
 *
 *  - `getQueryableFields` still excludes every masked field, and the
 *    middleware refuses every query at object admission
 *    (`PERMISSION_DENIED`, 403) before any field guard is asked;
 *  - the read is refused at object admission and the row scope is the deny
 *    sentinel, while `getReadableFields` keeps the masked fields as served
 *    columns (a field answer, not an object one);
 *  - a write echoing the masked placeholder is refused, now at object
 *    admission, ahead of the echo gate.
 *
 * The result masker's zero-set reading is still reached on the data plane
 * through the public-form grant, which admits ahead of object admission; that
 * door is pinned in `public-form-grant-masking.test.ts`.
 *
 * The last block pins the class's boundary: a principal-less context (no
 * position, no named set, no user id) is handed straight through by the
 * middleware, and the projections answer the same full set for it.
 *
 * Fixtures are synthetic. Harness mirrors `get-queryable-fields.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import type { FieldMaskingRule } from '@objectstack/spec/data';
import { SecurityPlugin } from './security-plugin.js';
import { maskFieldValue } from './field-masker.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const RULE: FieldMaskingRule = { keepHead: 1, keepTail: 1 };
const SCHEMAS: Record<string, unknown> = {
  ledger: {
    name: 'ledger',
    fields: {
      title: { type: 'text', label: 'Title' },
      // A rule with an unmask gate: lifted only for a caller holding the capability.
      gated_masked: { type: 'text', label: 'Gated', maskingRule: RULE, requiredPermissions: ['synth_unmask'] },
      // A rule with no gate: masked for every non-system caller.
      always_masked: { type: 'text', label: 'Always', maskingRule: RULE },
    },
  },
};
/** The field universe the plugin resolves: the schema's fields plus `id`. */
const FIELDS = ['id', 'title', 'gated_masked', 'always_masked'];
const MASKED = ['gated_masked', 'always_masked'];

const ROW = { id: 'r1', title: 'SYNTH-TITLE', gated_masked: 'SYNTHVALUE01', always_masked: 'SYNTHVALUE02' };

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
      list: async () => [] as PermissionSet[],
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

/** [#21079] The middleware's object-admission refusal: the deny baseline's answer to an empty set list. */
const REFUSED_AT_ADMISSION = { admitted: false, code: 'PERMISSION_DENIED', status: 403 } as const;

describe('[#20995] a caller who resolves no permission set: every masking rule applies in its field answers, and [#21079] object admission refuses it', () => {
  for (const c of ZERO_SET_CASES) {
    describe(c.label, () => {
      it('premise: resolution answers no permission set for this caller', async () => {
        const { security } = await boot({ noBaseline: c.noBaseline });
        expect(await security.resolvePermissionSetsForContext({ ...c.context })).toEqual([]);
      });

      it('the query projection excludes every masked field, and the middleware refuses every query at object admission', async () => {
        const { plugin, middleware } = await boot({ noBaseline: c.noBaseline });
        expect(await plugin.getQueryableFields('ledger', { ...c.context })).toEqual(FIELDS.filter((f) => !MASKED.includes(f)));
        for (const field of FIELDS) {
          for (const [position, operation, ast] of PROBES) {
            const verdict = await run(middleware, {
              object: 'ledger', operation, context: { ...c.context }, options: {}, ast: ast(field),
            });
            expect(verdict, `${field} as ${position}`).toEqual(REFUSED_AT_ADMISSION);
          }
        }
      });

      it('the read is refused at object admission and its row scope is the deny sentinel; the read projection keeps the masked fields as served columns', async () => {
        const { plugin, middleware } = await boot({ noBaseline: c.noBaseline });
        const opCtx: Record<string, any> = {
          object: 'ledger', operation: 'find', context: { ...c.context }, options: {}, ast: { where: {} },
        };
        expect(await run(middleware, opCtx)).toEqual(REFUSED_AT_ADMISSION);
        expect(await plugin.getReadFilter('ledger', { ...c.context })).toEqual({ ...RLS_DENY_FILTER });
        expect(await plugin.getReadableFields('ledger', { ...c.context })).toEqual(FIELDS);
      });

      it('a write echoing the masked placeholder is refused — at object admission, ahead of the echo gate', async () => {
        const { middleware } = await boot({ noBaseline: c.noBaseline });
        const verdict = await run(middleware, {
          object: 'ledger', operation: 'update', context: { ...c.context }, options: {},
          data: { id: 'r1', always_masked: maskFieldValue(ROW.always_masked, RULE) },
        });
        expect(verdict).toEqual(REFUSED_AT_ADMISSION);
      });
    });
  }
});

describe('[#20995] the class boundary: a principal-less context is handed through untouched, and the projections agree', () => {
  const PRINCIPAL_LESS = { positions: [], permissions: [] };

  it('the middleware serves every field as stored and admits a query on any field', async () => {
    const { middleware } = await boot();
    const opCtx: Record<string, any> = {
      object: 'ledger', operation: 'find', context: { ...PRINCIPAL_LESS }, options: {}, ast: { where: {} }, result: [{ ...ROW }],
    };
    expect(await run(middleware, opCtx)).toEqual({ admitted: true });
    expect(opCtx.result[0]).toEqual(ROW);
    for (const field of FIELDS) {
      for (const [position, operation, ast] of PROBES) {
        const verdict = await run(middleware, {
          object: 'ledger', operation, context: { ...PRINCIPAL_LESS }, options: {}, ast: ast(field),
        });
        expect(verdict, `${field} as ${position}`).toEqual({ admitted: true });
      }
    }
  });

  it('the read and query projections answer the full field set for it', async () => {
    const { plugin } = await boot();
    expect(await plugin.getReadableFields('ledger', { ...PRINCIPAL_LESS })).toEqual(FIELDS);
    expect(await plugin.getQueryableFields('ledger', { ...PRINCIPAL_LESS })).toEqual(FIELDS);
  });
});

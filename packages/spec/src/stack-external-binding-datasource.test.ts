// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §4.2 · #25168] `defineStack` refuses an object's `external`
 * binding on a managed datasource. ADR-0015 declared the rule "enforced at
 * metadata-load time" and `defineStack` accepted every such stack.
 *
 * Pinned, with the ADR-0112 envelope (`code` + `status: 422`):
 * - the stack half: a binding on a datasource the same stack declares
 *   `schemaMode: 'managed'`, or with no `schemaMode`, is refused with
 *   `STACK_CROSS_REFERENCE_INVALID`, one finding per object;
 * - the object half: a binding on `'default'`, written or omitted, is refused
 *   by the stack's parse with `STACK_SCHEMA_INVALID`, at `objects.N.external`;
 * - the CONTROLS: a datasource declared `external` or `validate-only` is
 *   accepted, and a datasource the stack does not declare gets no verdict;
 * - `strict: false` skips the judgement by contract.
 *
 * [#25211] …and `composeStacks` refuses the pair split across two inputs (the
 * object in one, its managed datasource in another), which each `defineStack`
 * accepted alone, in either order and under `last` and `preserve`, with the
 * same finding and envelope.
 */
import { describe, expect, it } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

type Envelope = Error & { code?: string; status?: number; issues?: readonly unknown[] };

const refusalOf = (stack: Record<string, unknown>, options?: { strict?: boolean }): Envelope | null => {
  try {
    defineStack(stack as never, options);
    return null;
  } catch (e) {
    return e as Envelope;
  }
};

const warehouse = (extra: Record<string, unknown> = {}) => ({
  name: 'warehouse',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  ...extra,
});
const order = (extra: Record<string, unknown> = {}) => ({
  name: 'wh_order',
  label: 'Order',
  sharingModel: 'private',
  fields: { title: { type: 'text', label: 'Title' } },
  external: { remoteName: 'orders' },
  ...extra,
});

describe('defineStack — an `external` binding on a managed datasource the stack declares', () => {
  it.each([
    ["`schemaMode: 'managed'`", { schemaMode: 'managed' }],
    ['no `schemaMode` (managed by default)', {}],
  ])('%s: STACK_CROSS_REFERENCE_INVALID, 422, one finding naming the object and the datasource', (_label, mode) => {
    const err = refusalOf({ datasources: [warehouse(mode)], objects: [order({ datasource: 'warehouse' })] });
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.issues).toHaveLength(1);
    expect(String(err!.issues![0])).toMatch(/^Object 'wh_order' declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'/);
  });

  it('one finding per bound object; an unbound object on the same datasource is not one', () => {
    const err = refusalOf({
      datasources: [warehouse()],
      objects: [
        order({ datasource: 'warehouse' }),
        order({ name: 'wh_line', datasource: 'warehouse', external: { remoteName: 'lines' } }),
        order({ name: 'wh_note', datasource: 'warehouse', external: undefined }),
      ],
    });
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err?.issues?.map((f) => String(f).match(/^Object '(\w+)'/)?.[1])).toEqual(['wh_order', 'wh_line']);
  });

  it.each(['external', 'validate-only'])("control — a datasource declared `schemaMode: '%s'` is accepted", (schemaMode) => {
    expect(refusalOf({
      datasources: [warehouse({ schemaMode, external: {} })],
      objects: [order({ datasource: 'warehouse' })],
    })).toBeNull();
  });

  it('a datasource the stack does not declare gets no verdict: the stack cannot see its `schemaMode`', () => {
    expect(refusalOf({ objects: [order({ datasource: 'lake' })] })).toBeNull();
    expect(refusalOf({ datasources: [warehouse()], objects: [order({ datasource: 'lake' })] })).toBeNull();
  });

  it('`strict: false` skips the judgement by contract', () => {
    expect(refusalOf({ datasources: [warehouse()], objects: [order({ datasource: 'warehouse' })] }, { strict: false })).toBeNull();
  });
});

describe('defineStack — an `external` binding on the primary datasource', () => {
  it.each([
    ['`datasource` omitted', {}],
    ["`datasource: 'default'`", { datasource: 'default' }],
  ])('%s: the parse refuses it, STACK_SCHEMA_INVALID, 422, at objects.0.external', (_label, extra) => {
    const err = refusalOf({ objects: [order(extra)] });
    expect(err?.code).toBe('STACK_SCHEMA_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.issues).toEqual([
      expect.objectContaining({ code: 'custom', path: ['objects', 0, 'external'] }),
    ]);
  });

  it('a package `defaultDatasource` naming an external datasource does not make the object federated', () => {
    const err = refusalOf({
      manifest: { id: 'com.acme.wh', namespace: 'wh', version: '1.0.0', type: 'app', name: 'wh', defaultDatasource: 'warehouse' },
      datasources: [warehouse({ schemaMode: 'external', external: {} })],
      objects: [order()],
    });
    expect(err?.code).toBe('STACK_SCHEMA_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.issues).toEqual([
      expect.objectContaining({ code: 'custom', path: ['objects', 0, 'external'] }),
    ]);
  });
});

describe('[#25211] composeStacks — an `external` binding on a managed datasource another input declares', () => {
  const manifest = (id: string) => ({ id, namespace: id.split('.').pop(), version: '1.0.0', type: 'plugin', name: id.split('.').pop() });
  const owner = (mode: Record<string, unknown>) => defineStack({
    manifest: manifest('com.acme.dsowner'),
    datasources: [warehouse(mode)],
  } as never);
  const consumer = (extra: Record<string, unknown> = {}) => defineStack({
    manifest: manifest('com.acme.wh'),
    objects: [order({ datasource: 'warehouse', ...extra })],
  } as never);
  const composeRefusal = (stacks: unknown[], options?: Record<string, unknown>): Envelope | null => {
    try {
      composeStacks(stacks as never, options as never);
      return null;
    } catch (e) {
      return e as Envelope;
    }
  };

  for (const [label, mode] of [["`schemaMode: 'managed'`", { schemaMode: 'managed' }], ['no `schemaMode`', {}]] as const) {
    it.each([
      ['owner first, `last`', false, 'last'],
      ['consumer first, `last`', true, 'last'],
      ['owner first, `preserve`', false, 'preserve'],
      ['consumer first, `preserve`', true, 'preserve'],
    ])(`${label}: each input builds alone, the composition is refused — %s`, (_order, reversed, manifestOpt) => {
      const stacks = reversed ? [consumer(), owner(mode)] : [owner(mode), consumer()];
      const err = composeRefusal(stacks, { manifest: manifestOpt });
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
      expect(err?.issues).toHaveLength(1);
      expect(String(err!.issues![0])).toMatch(/^Object 'wh_order' declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'/);
      expect(err!.message).toContain('composeStacks artifact cross-reference validation failed (1 issue):');
    });
  }

  it("an input built `strict: false` holding the pair itself is refused at composition, as the artifact pass's other rules are", () => {
    const loose = defineStack({
      manifest: manifest('com.acme.wh'),
      datasources: [warehouse()],
      objects: [order({ datasource: 'warehouse' })],
    } as never, { strict: false });
    const other = defineStack({ manifest: manifest('com.acme.other') } as never);
    expect(composeRefusal([loose, other])?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it.each(['last', 'preserve'])("control — the datasource declared `schemaMode: 'external'` composes (`%s`)", (manifestOpt) => {
    expect(composeRefusal([owner({ schemaMode: 'external', external: {} }), consumer()], { manifest: manifestOpt })).toBeNull();
    expect(composeRefusal([consumer(), owner({ schemaMode: 'external', external: {} })], { manifest: manifestOpt })).toBeNull();
  });

  it('control — a datasource no input declares gets no verdict, and an object without `external` on the managed one composes', () => {
    expect(composeRefusal([owner({}), consumer({ datasource: 'lake' })])).toBeNull();
    expect(composeRefusal([owner({}), consumer({ external: undefined })])).toBeNull();
  });
});

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
 */
import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';

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
  ])('%s: STACK_CROSS_REFERENCE_INVALID, 422, one finding naming the object, the datasource and both fixes', (_label, mode) => {
    const err = refusalOf({ datasources: [warehouse(mode)], objects: [order({ datasource: 'warehouse' })] });
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.message).toMatch(/^defineStack cross-reference validation failed \(1 issue\):/);
    expect(err?.issues).toHaveLength(1);
    const finding = String(err!.issues![0]);
    expect(finding).toMatch(/^Object 'wh_order' declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'/);
    expect(finding).toContain("ADR-0015 §4.2 allows `external` only on a datasource whose `schemaMode` is not 'managed'.");
    expect(finding).toContain("declare it with `schemaMode: 'external'` (or 'validate-only')");
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
    expect(err?.message).toContain("objects.0.external: Object 'wh_order' declares `external`, but its `datasource` is 'default'");
  });

  it('a package `defaultDatasource` naming an external datasource does not make the object federated', () => {
    const err = refusalOf({
      manifest: { id: 'com.acme.wh', namespace: 'wh', version: '1.0.0', type: 'app', name: 'wh', defaultDatasource: 'warehouse' },
      datasources: [warehouse({ schemaMode: 'external', external: {} })],
      objects: [order()],
    });
    expect(err?.code).toBe('STACK_SCHEMA_INVALID');
    expect(err?.message).toContain('A package `defaultDatasource` or a `datasourceMapping` rule does not count');
  });
});

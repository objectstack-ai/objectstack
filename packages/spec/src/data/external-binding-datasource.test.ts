// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §4.2 · #25168] The object half of "`object.external` only when the
 * object's datasource has `schemaMode !== 'managed'`": an `external` binding
 * whose object `datasource` is `'default'` — written, or the parsed value of an
 * omitted one — is refused by `ObjectSchema`'s parse, at `external`, because
 * the platform's primary datasource is managed by construction.
 *
 * Pinned: both spellings of the primary refused at the same path with the same
 * message, by `safeParse` and by `ObjectSchema.create` at module load; the
 * CONTROLS (a named datasource, which this half cannot judge, and an object
 * with no `external`) accepted; and the predicate's other half, which needs
 * the datasource's definition, answering from it alone.
 */
import { describe, expect, it } from 'vitest';
import { ObjectSchema } from './object.zod';
import { externalBindingDatasourceRefusal } from './external-binding-datasource';

const object = (extra: Record<string, unknown>) => ({
  name: 'wh_order',
  label: 'Order',
  sharingModel: 'private',
  fields: { title: { type: 'text', label: 'Title' } },
  ...extra,
});

const issuesOf = (value: unknown) => {
  const parsed = ObjectSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues;
};

const PRIMARY = /^Object 'wh_order' declares `external`, but its `datasource` is 'default' \(also the value when none is written\)/;

describe('ObjectSchema refuses an `external` binding on the primary datasource', () => {
  it.each([
    ['`datasource` omitted', { external: { remoteName: 'orders' } }],
    ["`datasource: 'default'`", { datasource: 'default', external: { remoteName: 'orders' } }],
    ['an empty binding', { external: {} }],
  ])('%s: one issue at `external`, naming the rule and both fixes', (_label, extra) => {
    const issues = issuesOf(object(extra));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['external'] });
    expect(issues[0]!.message).toMatch(PRIMARY);
    expect(issues[0]!.message).toContain("ADR-0015 §4.2 allows `external` only on a datasource whose `schemaMode` is not 'managed'.");
    expect(issues[0]!.message).toContain("declared with `schemaMode: 'external'` (or 'validate-only')");
    expect(issues[0]!.message).toContain('or remove `external` to keep this a managed object.');
  });

  it('`ObjectSchema.create` refuses it at module load, with the same issue', () => {
    let thrown: { issues?: Array<{ path: unknown[]; message: string }> } | undefined;
    try {
      ObjectSchema.create(object({ external: { remoteName: 'orders' } }) as never);
    } catch (e) {
      thrown = e as typeof thrown;
    }
    expect(thrown?.issues).toEqual([expect.objectContaining({ path: ['external'], message: expect.stringMatching(PRIMARY) })]);
  });

  it.each([
    ['a named datasource', { datasource: 'warehouse', external: { remoteName: 'orders' } }],
    ['no `external`, on the primary', { datasource: 'default' }],
    ['no `external`, `datasource` omitted', {}],
  ])('control — %s parses', (_label, extra) => {
    expect(issuesOf(object(extra))).toEqual([]);
  });
});

describe('externalBindingDatasourceRefusal — the one judgement both halves read', () => {
  it('answers nothing without a binding, whatever the datasource', () => {
    expect(externalBindingDatasourceRefusal('o', undefined, 'default')).toBeUndefined();
    expect(externalBindingDatasourceRefusal('o', null, 'warehouse', { schemaMode: 'managed' })).toBeUndefined();
  });

  it('answers nothing for a named datasource it cannot see', () => {
    expect(externalBindingDatasourceRefusal('o', {}, 'warehouse')).toBeUndefined();
  });

  it.each([
    ["declared 'managed'", { schemaMode: 'managed' }],
    ['declared with no `schemaMode` (managed by default)', {}],
  ])('refuses a binding on a datasource %s', (_label, declared) => {
    const refusal = externalBindingDatasourceRefusal('o', {}, 'warehouse', declared);
    expect(refusal).toMatchObject({ path: 'external', shape: 'managed', datasource: 'warehouse' });
    expect(refusal!.message).toMatch(/^Object 'o' declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'/);
  });

  it.each(['external', 'validate-only'])("accepts a binding on a datasource declared '%s'", (schemaMode) => {
    expect(externalBindingDatasourceRefusal('o', {}, 'warehouse', { schemaMode })).toBeUndefined();
  });

  it('judges the primary by name alone: a definition passed for it changes nothing', () => {
    expect(externalBindingDatasourceRefusal('o', {}, 'default', { schemaMode: 'external' })?.shape).toBe('primary');
  });
});

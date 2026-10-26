/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — the `app-shell` half, which the `tsc` errors reported
 * against `resolveActionParams.test.ts` only SURFACED.
 *
 * `@objectstack/spec` 17.0.0-rc.6 widened `I18nLabel` from `string` to
 * `string | Record<string, string>`, so the spec's `ActionParamSchema.label`
 * (and each option's `label`) admits an inline per-locale map. `RawActionParam`
 * is a local restatement of that authoring shape, and it still said `string` —
 * so the public authoring type stopped being assignable to it. Widening the
 * DECLARATION is the fix; this file pins the behaviour that has to come with it.
 *
 * The resolver emits `@object-ui/core`'s `ActionParamDef`, whose `label` is a
 * plain `string` and whose options' labels are plain `string`s. So the map may
 * not simply be carried through: `ActionParamDialog` renders both into text,
 * and an unresolved map arrives as `[object Object]` with nothing red anywhere.
 * Resolution therefore happens HERE, against the locale the caller threads in.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';

const ctx = (over: Partial<ResolveActionParamsContext> = {}): ResolveActionParamsContext => ({
  objectName: 'sys_user',
  objects: [
    { name: 'sys_user', fields: { phone_number: { type: 'text', label: 'Phone' } } },
  ],
  fieldLabel: (_o, _f, fallback) => fallback,
  ...over,
});

const REASON = { en: 'Reason', 'zh-CN': '原因' };

describe('resolveActionParams — inline per-locale param labels (#4163)', () => {
  it('resolves a map label for the threaded locale, on an inline param', () => {
    const params: RawActionParam[] = [{ name: 'reason', label: REASON }];
    expect(resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].label).toBe('原因');
  });

  it('resolves the same map differently for a different locale', () => {
    // The half that proves the LOCALE is read, not just that a string came out.
    const params: RawActionParam[] = [{ name: 'reason', label: REASON }];
    expect(resolveActionParams(params, ctx({ locale: 'en' }))[0].label).toBe('Reason');
  });

  it('never emits a non-string label', () => {
    const params: RawActionParam[] = [{ name: 'reason', label: REASON }];
    const label = resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].label;
    expect(typeof label).toBe('string');
    expect(String(label)).not.toBe('[object Object]');
  });

  it('falls back to `en` when no locale is threaded', () => {
    // `locale` is optional and nullish-tolerant; the spec's resolver documents
    // "no locale known" as resolving to `en`.
    const params: RawActionParam[] = [{ name: 'reason', label: REASON }];
    expect(resolveActionParams(params, ctx())[0].label).toBe('Reason');
  });

  it('leaves a plain-string label exactly as authored', () => {
    // Non-vacuity for every assertion above.
    const params: RawActionParam[] = [{ name: 'reason', label: 'Why?' }];
    expect(resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].label).toBe('Why?');
  });

  it('still falls through to `name` when the label is absent', () => {
    // The `?? param.name` chain has to keep working: the resolver answers
    // `undefined` for an absent label, which is nullish, so the chain proceeds.
    const params: RawActionParam[] = [{ name: 'reason' }];
    expect(resolveActionParams(params, ctx())[0].label).toBe('reason');
  });

  it('still falls through to `fieldLabel` on a field-backed param', () => {
    const params: RawActionParam[] = [{ field: 'phone_number' }];
    expect(resolveActionParams(params, ctx())[0].label).toBe('Phone');
  });

  it('an authored EMPTY label still wins over the fallbacks', () => {
    // `''` is not nullish and the resolver returns it verbatim — "an author who
    // wrote an empty label wrote a label". Pinned because a resolver that
    // answered `undefined` for `''` would silently change this branch.
    const params: RawActionParam[] = [{ name: 'reason', label: '' }];
    expect(resolveActionParams(params, ctx())[0].label).toBe('');
  });

  it('a map that matches no limb falls through to the fallback, not to `[object Object]`', () => {
    const params: RawActionParam[] = [{ name: 'reason', label: {} }];
    expect(resolveActionParams(params, ctx())[0].label).toBe('reason');
  });

  it('resolves a map label on the field-backed branch too', () => {
    const params: RawActionParam[] = [{ field: 'phone_number', label: REASON }];
    expect(resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].label).toBe('原因');
  });

  it('resolves a map label on the missing-field fallback branch too', () => {
    // Three emission sites, three pins — a fix applied to one leaves the others
    // shipping the map, with every type still green.
    const params: RawActionParam[] = [{ field: 'does_not_exist', label: REASON }];
    expect(resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].label).toBe('原因');
  });
});

describe('resolveActionParams — inline per-locale OPTION labels (#4163)', () => {
  const options = [
    { value: 'high', label: { en: 'High', 'zh-CN': '高' }, color: 'red' },
    { value: 'low', label: 'Low' },
  ];

  it('resolves each inline option label for the threaded locale', () => {
    const params: RawActionParam[] = [{ name: 'priority', type: 'select', options }];
    const resolved = resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].options!;
    expect(resolved.map((o) => o.label)).toEqual(['高', 'Low']);
  });

  it('never emits a non-string option label', () => {
    // Inline options pass through VERBATIM (that asymmetry is objectui#3559's
    // deliberate shape), so without a crossing point the map rode straight into
    // the select widget — the silent `[object Object]` this card is about.
    const params: RawActionParam[] = [{ name: 'priority', type: 'select', options }];
    const resolved = resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].options!;
    for (const option of resolved) expect(typeof option.label).toBe('string');
  });

  it('preserves every other key the option declared', () => {
    // objectui#3559's rule: resolve the label, rebuild nothing. A fresh
    // `{ label, value }` would drop `color` / `visibleWhen` / `icon` /
    // `disabled` and no assertion about labels would notice.
    const params: RawActionParam[] = [{ name: 'priority', type: 'select', options }];
    const resolved = resolveActionParams(params, ctx({ locale: 'zh-CN' }))[0].options!;
    expect(resolved[0]).toMatchObject({ value: 'high', color: 'red' });
  });

  it('falls back to `value` for an option whose label resolves to nothing', () => {
    // Which is exactly what the bare-string option shorthand already means
    // (`{ label: s, value: s }`).
    const params: RawActionParam[] = [
      { name: 'priority', type: 'select', options: [{ value: 'high' }] },
    ];
    expect(resolveActionParams(params, ctx())[0].options![0].label).toBe('high');
  });

  it('leaves a field-inherited option list alone', () => {
    // Non-vacuity in the other direction: the field branch goes through
    // `normaliseOptions`, not the new crossing point, and must be unchanged.
    const params: RawActionParam[] = [{ field: 'status' }];
    const resolved = resolveActionParams(
      params,
      ctx({
        objects: [
          {
            name: 'sys_user',
            fields: { status: { type: 'select', options: ['active', 'closed'] } },
          },
        ],
      }),
    )[0].options!;
    expect(resolved.map((o) => o.label)).toEqual(['active', 'closed']);
  });
});

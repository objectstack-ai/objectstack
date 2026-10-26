/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit coverage for cascading / role-gated option resolution (#2284).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveDependsOnFields,
  isOptionGroupGated,
  resolveVisibleOptions,
  isValueStillOffered,
  resolveCascadingOptions,
  optionDisplayLabel,
  type OptionLike,
} from '../optionRules';

const provinces: OptionLike[] = [
  { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
  { label: 'Guangdong', value: 'gd', visibleWhen: "record.country == 'cn'" },
  { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  { label: 'Texas', value: 'tx', visibleWhen: "record.country == 'us'" },
  { label: 'Other', value: 'other' }, // no predicate → always offered
];

describe('resolveDependsOnFields', () => {
  it('normalizes bare string, array of strings, and {field,param}', () => {
    expect(resolveDependsOnFields('country')).toEqual(['country']);
    expect(resolveDependsOnFields(['country', 'region'])).toEqual(['country', 'region']);
    expect(resolveDependsOnFields([{ field: 'country', param: 'country_id' }])).toEqual(['country']);
    expect(resolveDependsOnFields(undefined)).toEqual([]);
    expect(resolveDependsOnFields(null)).toEqual([]);
  });
});

describe('isOptionGroupGated', () => {
  it('is gated while a dependency is empty and unlocks once set', () => {
    expect(isOptionGroupGated('country', {})).toBe(true);
    expect(isOptionGroupGated('country', { country: '' })).toBe(true);
    expect(isOptionGroupGated('country', { country: null })).toBe(true);
    expect(isOptionGroupGated('country', { country: 'cn' })).toBe(false);
  });

  it('requires ALL dependencies to be present', () => {
    expect(isOptionGroupGated(['country', 'region'], { country: 'cn' })).toBe(true);
    expect(isOptionGroupGated(['country', 'region'], { country: 'cn', region: 'east' })).toBe(false);
  });

  it('is never gated when there are no dependencies', () => {
    expect(isOptionGroupGated(undefined, {})).toBe(false);
  });
});

describe('resolveVisibleOptions — cascade', () => {
  it('narrows the list to the controlling value', () => {
    const cn = resolveVisibleOptions(provinces, { country: 'cn' }).map((o) => o.value);
    expect(cn).toEqual(['zj', 'gd', 'other']);

    const us = resolveVisibleOptions(provinces, { country: 'us' }).map((o) => o.value);
    expect(us).toEqual(['ca', 'tx', 'other']);
  });

  it('keeps only predicate-less options when the parent is present-but-null', () => {
    // The form renderer seeds every declared field to `null` (see form.tsx
    // ruleRecord), so an unset parent evaluates as `null == 'cn'` → false and the
    // dependent options are hidden — leaving only the predicate-less 'other'.
    const none = resolveVisibleOptions(provinces, { country: null }).map((o) => o.value);
    expect(none).toEqual(['other']);
  });

  it('fails open (keeps the option) when the referenced field is entirely absent', () => {
    // A *missing* key (not seeded to null) makes the CEL engine fault; per the
    // fail-open convention a broken predicate keeps the option. In practice
    // `dependsOn` gating withholds the whole list first, so this only surfaces for
    // predicate options with no declared dependency.
    const all = resolveVisibleOptions(provinces, {}).map((o) => o.value);
    expect(all).toEqual(['zj', 'gd', 'ca', 'tx', 'other']);
  });

  it('returns [] for empty / missing option lists', () => {
    expect(resolveVisibleOptions([], { country: 'cn' })).toEqual([]);
    expect(resolveVisibleOptions(undefined, { country: 'cn' })).toEqual([]);
  });
});

describe('resolveVisibleOptions — role / context gating via scope', () => {
  const options: OptionLike[] = [
    { label: 'Standard', value: 'standard' },
    { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
  ];

  it('hides the admin option for a non-admin', () => {
    const vals = resolveVisibleOptions(options, {}, { current_user: { positions: ['sales'] } }).map(
      (o) => o.value,
    );
    expect(vals).toEqual(['standard']);
  });

  it('offers the admin option to an admin', () => {
    const vals = resolveVisibleOptions(options, {}, { current_user: { positions: ['admin'] } }).map(
      (o) => o.value,
    );
    expect(vals).toEqual(['standard', 'admin_only']);
  });
});

describe('isValueStillOffered — cascade clear decision', () => {
  const cnOptions = resolveVisibleOptions(provinces, { country: 'cn' });

  it('treats empty values as always valid (nothing to clear)', () => {
    expect(isValueStillOffered(undefined, cnOptions)).toBe(true);
    expect(isValueStillOffered('', cnOptions)).toBe(true);
    expect(isValueStillOffered([], cnOptions)).toBe(true);
  });

  it('flags a value dropped by a parent change', () => {
    // 'ca' was valid under country=us but not under country=cn.
    expect(isValueStillOffered('ca', cnOptions)).toBe(false);
    expect(isValueStillOffered('zj', cnOptions)).toBe(true);
  });

  it('handles multi-select arrays element-wise', () => {
    expect(isValueStillOffered(['zj', 'gd'], cnOptions)).toBe(true);
    expect(isValueStillOffered(['zj', 'ca'], cnOptions)).toBe(false);
  });
});

describe('resolveCascadingOptions — one-shot resolution', () => {
  it('gates (empty options) while a dependsOn parent is empty', () => {
    const r = resolveCascadingOptions(provinces, {}, 'country');
    expect(r.gated).toBe(true);
    expect(r.options).toEqual([]);
    expect(r.dependsOnFields).toEqual(['country']);
  });

  it('filters by visibleWhen once the parent is set', () => {
    const r = resolveCascadingOptions(provinces, { country: 'cn' }, 'country');
    expect(r.gated).toBe(false);
    expect(r.options.map((o) => o.value)).toEqual(['zj', 'gd', 'other']);
  });

  it('is never gated without a dependsOn — still filters by visibleWhen', () => {
    const r = resolveCascadingOptions(provinces, { country: 'us' }, undefined);
    expect(r.gated).toBe(false);
    expect(r.dependsOnFields).toEqual([]);
    expect(r.options.map((o) => o.value)).toEqual(['ca', 'tx', 'other']);
  });

  it('threads the predicate scope for role/context gating', () => {
    const tier: OptionLike[] = [
      { label: 'Standard', value: 'standard' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ];
    const nonAdmin = resolveCascadingOptions(tier, {}, undefined, {
      current_user: { positions: ['sales'] },
    });
    expect(nonAdmin.options.map((o) => o.value)).toEqual(['standard']);
    const admin = resolveCascadingOptions(tier, {}, undefined, {
      current_user: { positions: ['admin'] },
    });
    expect(admin.options.map((o) => o.value)).toEqual(['standard', 'admin_only']);
  });
});


describe('optionDisplayLabel — a blank label falls back to the value (objectui#9230)', () => {
  it('returns the label when there is one', () => {
    expect(optionDisplayLabel({ label: 'High', value: 'high' })).toBe('High');
  });

  it('falls back to the value when the label is the empty string', () => {
    // The shape the field designer writes when the author fills only the
    // value box. It is a LEGAL document (the spec requires the key and
    // accepts ''), so the fallback is display, never a rewrite of metadata.
    expect(optionDisplayLabel({ label: '', value: 'low' })).toBe('low');
  });

  it('falls back when the label is only whitespace — the same invisible row', () => {
    expect(optionDisplayLabel({ label: '   ', value: 'low' })).toBe('low');
    expect(optionDisplayLabel({ label: '\n\t', value: 'low' })).toBe('low');
  });

  it('keeps a label whose text merely has surrounding space', () => {
    // Trim decides EMPTINESS only; it never edits the text that is shown.
    expect(optionDisplayLabel({ label: ' High ', value: 'high' })).toBe(' High ');
  });

  it('stringifies a non-string value for the fallback (#3090-widened values)', () => {
    expect(optionDisplayLabel({ label: '', value: 5 })).toBe('5');
    expect(optionDisplayLabel({ label: '', value: true })).toBe('true');
  });

  it('falls back rather than throwing on unvalidated runtime metadata', () => {
    // `label` is typed required, but renderers are handed raw metadata. The
    // old `{opt.label}` rendered nothing here; a `.trim()` with no guard would
    // throw and take the whole form down, which is strictly worse than blank.
    const absent = { value: 'low' } as unknown as OptionLike;
    expect(optionDisplayLabel(absent)).toBe('low');
    const wrongType = { label: 5, value: 'low' } as unknown as OptionLike;
    expect(optionDisplayLabel(wrongType)).toBe('low');
  });
});

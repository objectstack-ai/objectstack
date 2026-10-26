// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics label net's REACT-FREE half (objectui#4389) — `loadDimensionFieldMeta`,
 * `deriveDimensionLabelMaps` and `dimensionOptionTranslator`.
 *
 * These three were written out longhand inside `DatasetWidget`'s effect/memo and
 * again inside plugin-report's `useDatasetDimensionLabels` (PR #4388). They are
 * pure, so they belong on this side of the layer — the React wiring that could
 * not follow them here (the `SchemaRendererContext` read, the state, the memo
 * boundary) lives in `@object-ui/react`, for the dependency-direction reason
 * recorded in the card's PM RULING #2.
 *
 * The pins below assert the two facts the longhand copies each had to get right
 * on their own, and which are the reason this is worth sharing at all:
 *
 *  - the base object is read ONCE per query, and a dotted path's hop is read
 *    once too — the memoized loader, not one read per dimension;
 *  - the translator is bound to the object that OWNS the terminal field (the
 *    relationship TARGET for a dotted path), because that owner is the key the
 *    locale bundle is written under.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  deriveDimensionLabelMaps,
  dimensionOptionTranslator,
  loadDimensionFieldMeta,
  type DimensionFieldMeta,
} from '../chart-series';

const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];
const INDUSTRY_OPTIONS = [
  { value: 'chem', label: 'Chemicals' },
  { value: 'auto', label: 'Automotive' },
];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    sales_channel: { type: 'select', options: CHANNEL_OPTIONS },
    amount: { type: 'currency' },
    account: { type: 'lookup', reference: 'crm_account' },
  },
};
const ACCOUNT = {
  name: 'crm_account',
  fields: { industry: { type: 'select', options: INDUSTRY_OPTIONS } },
};

function makeLoader(docs: Record<string, unknown>) {
  const requested: string[] = [];
  const load = vi.fn(async (name: string) => {
    requested.push(name);
    return docs[name] ?? null;
  });
  return { load, requested };
}

describe('loadDimensionFieldMeta (objectui#4389)', () => {
  it('reads the base object once and resolves every local dimension from it', async () => {
    const { load, requested } = makeLoader({ crm_opportunity: OPPORTUNITY });

    const meta = await loadDimensionFieldMeta(load, 'crm_opportunity', ['sales_channel', 'amount']);

    // ONE read for the whole query — the base schema is seeded into the walk's
    // cache under its own `name`, so resolving N dimensions never re-reads it.
    expect(requested).toEqual(['crm_opportunity']);
    expect(meta['sales_channel']).toEqual({
      object: 'crm_opportunity',
      field: 'sales_channel',
      options: CHANNEL_OPTIONS,
    });
    // A field carrying no `options` yields NO entry — this is the exact gate
    // that makes the read safe to issue unconditionally (objectui#4330).
    expect(meta['amount']).toBeUndefined();
  });

  it('walks a dotted path to the relationship target and keeps that target as the owner', async () => {
    const { load, requested } = makeLoader({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });

    const meta = await loadDimensionFieldMeta(load, 'crm_opportunity', [
      'sales_channel',
      'account.industry',
    ]);

    expect(requested).toEqual(['crm_opportunity', 'crm_account']);
    expect(meta['account.industry']).toEqual({
      object: 'crm_account',
      field: 'industry',
      options: INDUSTRY_OPTIONS,
    });
  });

  it('reads a shared relationship prefix once across sibling dimensions', async () => {
    const ACCOUNT_TWO_SELECTS = {
      name: 'crm_account',
      fields: {
        industry: { type: 'select', options: INDUSTRY_OPTIONS },
        tier: { type: 'select', options: [{ value: 'a', label: 'A' }] },
      },
    };
    const { load, requested } = makeLoader({
      crm_opportunity: OPPORTUNITY,
      crm_account: ACCOUNT_TWO_SELECTS,
    });

    await loadDimensionFieldMeta(load, 'crm_opportunity', ['account.industry', 'account.tier']);

    expect(requested).toEqual(['crm_opportunity', 'crm_account']);
  });
});

describe('dimensionOptionTranslator (objectui#4389)', () => {
  const meta: DimensionFieldMeta = {
    object: 'crm_account',
    field: 'industry',
    options: INDUSTRY_OPTIONS,
  };

  it('binds the resolver to the OWNING object and terminal field', () => {
    const seen: Array<[string, string, string, string]> = [];
    const translate = dimensionOptionTranslator(meta, (o, f, v, a) => {
      seen.push([o, f, v, a]);
      return `${o}.${f}.${v}`;
    });

    expect(translate?.('chem', 'Chemicals')).toBe('crm_account.industry.chem');
    // The owner is the relationship TARGET, never the dataset's base object.
    expect(seen).toEqual([['crm_account', 'industry', 'chem', 'Chemicals']]);
  });

  it('returns undefined when the owner is unresolved or no resolver was given', () => {
    expect(dimensionOptionTranslator(meta, undefined)).toBeUndefined();
    expect(dimensionOptionTranslator(undefined, (_o, _f, _v, a) => a)).toBeUndefined();
    expect(
      dimensionOptionTranslator({ object: undefined, field: 'industry', options: [] }, (_o, _f, _v, a) => a),
    ).toBeUndefined();
  });
});

describe('deriveDimensionLabelMaps (objectui#4389)', () => {
  const metaByPath: Record<string, DimensionFieldMeta> = {
    sales_channel: { object: 'crm_opportunity', field: 'sales_channel', options: CHANNEL_OPTIONS },
    'account.industry': { object: 'crm_account', field: 'industry', options: INDUSTRY_OPTIONS },
  };
  const relabel = [
    { dim: 'sales_channel', path: 'sales_channel' },
    { dim: 'industry', path: 'account.industry' },
  ];

  /** A zh bundle, as `fieldOptionLabel` would resolve it. */
  const zh = (object: string, field: string, value: string, authored: string) =>
    ({
      'crm_opportunity.sales_channel.domestic': '国内',
      'crm_opportunity.sales_channel.export': '出口',
      'crm_account.industry.chem': '化工',
    } as Record<string, string>)[`${object}.${field}.${value}`] ?? authored;

  it('keys each dimension by BOTH the stored value and the authored label', () => {
    const maps = deriveDimensionLabelMaps(metaByPath, relabel, zh);

    expect(maps?.sales_channel).toEqual({
      domestic: '国内',
      Domestic: '国内',
      export: '出口',
      Export: '出口',
    });
    // `auto` has no bundle entry, so its display falls back to the AUTHORED
    // label — which still differs from the stored value, so it keeps a
    // value → label key. That is the net's ORIGINAL job (objectui#4053:
    // resolve a raw stored enum the server did not resolve) surviving
    // underneath the #4030 translation layer, not a leak. It gains no
    // authored-label key, because for it display === label.
    expect(maps?.industry).toEqual({ chem: '化工', Chemicals: '化工', auto: 'Automotive' });
  });

  it('is the pre-#4030 value → label map when no translator is supplied', () => {
    // MEASURED, and the opposite of what this pin first asserted: without a
    // translator the display IS the authored label, so no AUTHORED-label key is
    // ever emitted — but the value → label keys remain, because that resolution
    // predates #4030 and is the reason the net exists at all (objectui#4053).
    // Reporting the behaviour rather than the guess: a translator-free call is
    // not a no-op, it is the original resolver.
    expect(deriveDimensionLabelMaps(metaByPath, relabel)).toEqual({
      sales_channel: { domestic: 'Domestic', export: 'Export' },
      industry: { chem: 'Chemicals', auto: 'Automotive' },
    });
  });

  it('returns null when relabeling really would be a no-op (bare-string options)', () => {
    // Bare-string options are their own label, so value === label: nothing to
    // resolve and nothing to translate. THIS is the null case, and it is what
    // lets a caller skip `relabelDimensions` and keep its row array identity.
    const bare: Record<string, DimensionFieldMeta> = {
      sales_channel: {
        object: 'crm_opportunity',
        field: 'sales_channel',
        options: ['domestic', 'export'],
      },
    };
    expect(
      deriveDimensionLabelMaps(bare, [{ dim: 'sales_channel', path: 'sales_channel' }]),
    ).toBeNull();
  });

  it('returns null for empty or absent inputs rather than an empty object', () => {
    expect(deriveDimensionLabelMaps(null, relabel, zh)).toBeNull();
    expect(deriveDimensionLabelMaps(metaByPath, null, zh)).toBeNull();
    expect(deriveDimensionLabelMaps(metaByPath, [], zh)).toBeNull();
    expect(deriveDimensionLabelMaps({}, relabel, zh)).toBeNull();
  });

  it('skips a dimension whose path resolved nothing, keeping the others', () => {
    const maps = deriveDimensionLabelMaps(
      metaByPath,
      [...relabel, { dim: 'unresolved', path: 'no.such.path' }],
      zh,
    );

    expect(maps).not.toBeNull();
    expect(Object.keys(maps ?? {})).toEqual(['sales_channel', 'industry']);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4030 (source thread objectstack#5076) — the analytics label net
 * RESOLVES a select dimension's option label and then never runs it through the
 * locale bundle, so a chart legend reads `Orion Engineered Carbons` (the
 * object's authored English `label`, verbatim) while the related list on the
 * same page reads `欧励隆`.
 *
 * The decisive fixture is the reporter's `orion` row, and it is decisive
 * because the rendered string bears NO resemblance to the stored value: it can
 * only have come from the option label, which is what separates this from "the
 * report groups by stored value". `domestic → Domestic` differs from its value
 * by case alone and is exactly why the first diagnosis was wrong; both are
 * fixtures here for that reason.
 *
 * These are the pure pins for the seam itself. The surface pins (what a chart
 * legend / table cell actually renders under a zh-CN bundle) live in
 * `plugin-dashboard`.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the NO-TRANSLATOR cases are green on both sides — they are the pre-#4030
 *    behaviour restated, and the whole safety argument of this change is that
 *    an app with no bundle entry keeps the authored label it has today;
 *  - every case that passes a translator is RED before the change: without the
 *    seam the extra argument is ignored and the authored English label comes
 *    back;
 *  - `resolveDimensionFieldMeta` / `localizeFieldOptions` do not exist before
 *    it at all, so those cases fail at import.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildDimensionLabelMap,
  buildOptionColorMap,
  buildCategoryOrder,
  localizeFieldOptions,
  relabelDimensions,
  resolveDimensionFieldMeta,
  resolveDimensionFieldOptions,
  type OptionLabelTranslator,
} from '../chart-series';

/** The card's own field: English option labels, one of them unrecognisable. */
const COMPETITOR_OPTIONS = [
  { value: 'cabot', label: 'Cabot', color: 'blue' },
  { value: 'orion', label: 'Orion Engineered Carbons', color: 'green' },
];

/** The zh-CN bundle the reporter authored, keyed by the STORED value. */
const ZH: Record<string, string> = { cabot: '卡博特', orion: '欧励隆' };

/**
 * Stand-in for `useObjectLabel().fieldOptionLabel(object, field, …)` bound to
 * one field: a bundle hit wins, a miss falls back to the authored label. That
 * fallback is not a detail — it IS today's behaviour, and every "no bundle
 * entry" pin below rides on it.
 */
const zhTranslator: OptionLabelTranslator = (value, authored) => ZH[value] ?? authored;

describe('buildDimensionLabelMap — the locale bundle at the label net (objectui#4030)', () => {
  it('keeps the pre-#4030 map when no translator is supplied', () => {
    // Control, green on both sides of the change: without a bundle in play the
    // map is byte-for-byte what it always was.
    expect(buildDimensionLabelMap(COMPETITOR_OPTIONS)).toEqual({
      cabot: 'Cabot',
      orion: 'Orion Engineered Carbons',
    });
  });

  it('maps the stored value to the TRANSLATED label', () => {
    expect(buildDimensionLabelMap(COMPETITOR_OPTIONS, zhTranslator)).toMatchObject({
      cabot: '卡博特',
      orion: '欧励隆',
    });
  });

  it('ALSO maps the authored English label, so a server-resolved row re-translates', () => {
    // The rows reach this net keyed either way: value-keyed when the server did
    // not resolve the dimension (the reason the net exists), already
    // label-keyed when it did (ADR-0021). The reported symptom is the second
    // case — a legend showing the object's `label` verbatim — so the map must
    // answer to both keys or the fix misses the very screen in the issue.
    const map = buildDimensionLabelMap(COMPETITOR_OPTIONS, zhTranslator);
    expect(map?.['Orion Engineered Carbons']).toBe('欧励隆');
    expect(map?.Cabot).toBe('卡博特');
  });

  it('falls back to the authored label for an option the bundle does not carry', () => {
    // The card's whole downstream-impact section is about NOT losing the
    // English label for locales that have no translation.
    const map = buildDimensionLabelMap(
      [...COMPETITOR_OPTIONS, { value: 'birla', label: 'Birla Carbon' }],
      zhTranslator,
    );
    expect(map?.birla).toBe('Birla Carbon');
  });

  it('emits no second key when the translation IS the authored label (en locale)', () => {
    // Under `en` the resolver returns the fallback, so the map must collapse
    // back to exactly the untranslated one — no `Cabot → Cabot` self-entries.
    const identity: OptionLabelTranslator = (_v, authored) => authored;
    expect(buildDimensionLabelMap(COMPETITOR_OPTIONS, identity)).toEqual(
      buildDimensionLabelMap(COMPETITOR_OPTIONS),
    );
  });

  it('translates a BARE-STRING option, which has a value but no distinct label', () => {
    // `options: ['orion']` is a legal select spelling and the bundle is keyed
    // by the stored value, so there is nothing to resolve but something to
    // translate. Without a translator it still yields nothing (pinned in
    // `chart-series.test.ts`), because value and label are then the same string.
    expect(buildDimensionLabelMap(['cabot', 'orion'])).toBeNull();
    expect(buildDimensionLabelMap(['cabot', 'orion'], zhTranslator)).toEqual({
      cabot: '卡博特',
      orion: '欧励隆',
    });
  });

  it('lets a VALUE key win over another option’s authored-label key', () => {
    // Pathological but decidable: one option's stored value is spelled exactly
    // like another's English label. The value is the identity, so it wins.
    const map = buildDimensionLabelMap(
      [
        { value: 'Cabot', label: 'Cabot Corporation' },
        { value: 'cabot', label: 'Cabot' },
      ],
      (value, authored) => (value === 'Cabot' ? '卡博特集团' : value === 'cabot' ? '卡博特' : authored),
    );
    expect(map?.Cabot).toBe('卡博特集团');
  });
});

describe('relabelDimensions × the translated map (the rendered end of it)', () => {
  const rows = [
    { competitor_name: 'orion', deals: 7 },
    { competitor_name: 'cabot', deals: 3 },
  ];

  it('puts the translation on the category with the measure still attached', () => {
    const map = buildDimensionLabelMap(COMPETITOR_OPTIONS, zhTranslator);
    expect(relabelDimensions(rows, { competitor_name: map! })).toEqual([
      { competitor_name: '欧励隆', deals: 7 },
      { competitor_name: '卡博特', deals: 3 },
    ]);
  });

  it('translates rows the SERVER already resolved to the English label', () => {
    const serverResolved = [
      { competitor_name: 'Orion Engineered Carbons', deals: 7 },
      { competitor_name: 'Cabot', deals: 3 },
    ];
    const map = buildDimensionLabelMap(COMPETITOR_OPTIONS, zhTranslator);
    expect(relabelDimensions(serverResolved, { competitor_name: map! })).toEqual([
      { competitor_name: '欧励隆', deals: 7 },
      { competitor_name: '卡博特', deals: 3 },
    ]);
  });

  it('does NOT touch the raw input rows — drill-through still filters by `orion`', () => {
    // The stored value is the identity key (#4263's convention: display
    // translates, identity keys do not). `relabelDimensions` returns a new
    // array; the raw rows the drill filter is built from must survive.
    const map = buildDimensionLabelMap(COMPETITOR_OPTIONS, zhTranslator);
    relabelDimensions(rows, { competitor_name: map! });
    expect(rows[0].competitor_name).toBe('orion');
  });
});

describe('localizeFieldOptions — the list/form channel, applied to analytics options', () => {
  it('replaces only the label, keeping value and colour', () => {
    const localized = localizeFieldOptions(COMPETITOR_OPTIONS, zhTranslator) as Array<
      Record<string, unknown>
    >;
    expect(localized).toEqual([
      { value: 'cabot', label: '卡博特', color: 'blue' },
      { value: 'orion', label: '欧励隆', color: 'green' },
    ]);
  });

  it('returns the input ARRAY ITSELF when nothing translated', () => {
    // Identity, not just equality: an untranslated app must keep the option
    // identities it had, so downstream memoization behaves exactly as before.
    expect(localizeFieldOptions(COMPETITOR_OPTIONS)).toBe(COMPETITOR_OPTIONS);
    expect(localizeFieldOptions(COMPETITOR_OPTIONS, (_v, authored) => authored)).toBe(
      COMPETITOR_OPTIONS,
    );
  });

  it('keeps colours and declared order reachable under the TRANSLATED category', () => {
    // Colours and category order are keyed by value AND label; after the
    // relabel above a row's category is the translated string, so feeding both
    // helpers the localized options is what keeps a "Cabot" bar blue and a
    // funnel in its authored sequence in a zh-CN console.
    const localized = localizeFieldOptions(COMPETITOR_OPTIONS, zhTranslator);
    expect(buildOptionColorMap(localized)).toMatchObject({ orion: 'green', 欧励隆: 'green' });
    expect(buildCategoryOrder(localized)).toEqual(['cabot', '卡博特', 'orion', '欧励隆']);
  });

  it('tolerates the shapes the metadata really carries', () => {
    expect(localizeFieldOptions(undefined, zhTranslator)).toBeUndefined();
    expect(localizeFieldOptions([], zhTranslator)).toEqual([]);
    expect(localizeFieldOptions([null, 3, { value: 'orion', label: 'Orion Engineered Carbons' }], zhTranslator))
      .toEqual([null, 3, { value: 'orion', label: '欧励隆' }]);
  });
});

describe('resolveDimensionFieldMeta — WHICH object keys the bundle (objectui#4030)', () => {
  const OPPORTUNITY = {
    name: 'crm_opportunity',
    fields: {
      competitor_name: { type: 'select', options: COMPETITOR_OPTIONS },
      crm_account: { type: 'lookup', reference: 'crm_account' },
    },
  };
  const ACCOUNT = {
    name: 'crm_account',
    fields: { industry: { type: 'select', options: [{ value: 'edu', label: 'Education' }] } },
  };
  const load = vi.fn(async (name: string) => (name === 'crm_account' ? ACCOUNT : null));

  it('names the BASE object for a local field', async () => {
    const meta = await resolveDimensionFieldMeta(OPPORTUNITY, ['competitor_name'], load);
    expect(meta.competitor_name).toEqual({
      object: 'crm_opportunity',
      field: 'competitor_name',
      options: COMPETITOR_OPTIONS,
    });
  });

  it('names the RELATIONSHIP TARGET for a dotted path, and the TERMINAL field', async () => {
    // The bundle key is `fieldOptions.<owner>.<field>.<value>`; keying a dotted
    // dimension against the dataset's base object, or against the dotted path
    // as if it were a field name, resolves to nothing at all.
    const meta = await resolveDimensionFieldMeta(OPPORTUNITY, ['crm_account.industry'], load);
    expect(meta['crm_account.industry']).toMatchObject({
      object: 'crm_account',
      field: 'industry',
    });
  });

  it('still answers `resolveDimensionFieldOptions` with the options alone', async () => {
    // The #4053 / PR #4261 contract is unchanged — this is the same one walk.
    await expect(
      resolveDimensionFieldOptions(OPPORTUNITY, ['competitor_name', 'crm_account.industry'], load),
    ).resolves.toEqual({
      competitor_name: COMPETITOR_OPTIONS,
      'crm_account.industry': ACCOUNT.fields.industry.options,
    });
  });
});

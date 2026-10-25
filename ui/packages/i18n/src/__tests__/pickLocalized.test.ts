import { describe, it, expect } from 'vitest';
import { pickLocalized } from '../pickLocalized';

describe('pickLocalized', () => {
  it('passes plain strings through', () => {
    expect(pickLocalized('Pricing', 'zh-CN')).toBe('Pricing');
  });
  it('picks the exact language key', () => {
    expect(pickLocalized({ en: 'Pricing', 'zh-CN': '定价' }, 'zh-CN')).toBe('定价');
  });
  it('falls back from region to base language (zh-CN -> zh)', () => {
    expect(pickLocalized({ en: 'Pricing', zh: '定价' }, 'zh-CN')).toBe('定价');
  });
  it('upgrades from base language to a region-qualified key (zh -> zh-CN)', () => {
    expect(pickLocalized({ en: 'Pricing', 'zh-CN': '定价' }, 'zh')).toBe('定价');
    expect(pickLocalized({ en: 'Pricing', 'ja-JP': '価格' }, 'ja')).toBe('価格');
    // exact/base keys still win over the regional upgrade
    expect(pickLocalized({ zh: '基础', 'zh-CN': '区域' }, 'zh')).toBe('基础');
  });
  it('falls back to default then en then first', () => {
    expect(pickLocalized({ default: 'D', en: 'E' }, 'fr')).toBe('D');
    expect(pickLocalized({ en: 'E', ja: 'J' }, 'fr')).toBe('E');
    expect(pickLocalized({ ja: 'J' }, 'fr')).toBe('J');
  });
  it('handles null/undefined and missing language', () => {
    expect(pickLocalized(null, 'zh')).toBe('');
    expect(pickLocalized(undefined, 'zh')).toBe('');
    expect(pickLocalized({ en: 'E' }, undefined)).toBe('E');
  });
});

/**
 * objectui#3907 — every limb reads OWN properties only, and accepts only
 * `string` values.
 *
 * Both halves used to hold on limbs 3 and 6 alone, so the other four limbs
 * (exact tag, base language, `default`, `en`) could resolve against
 * `Object.prototype` and could short-circuit the chain with a non-string. They
 * are the two departures the backend twin `resolveI18nLabel` (objectstack#6765,
 * `packages/spec/src/ui/i18n-label-resolver.ts`) documented as deliberate
 * narrowings of this function; landing them here collapses that recorded
 * divergence to zero.
 *
 * ## The shape of the fix is "the limb misses", NOT "the call returns `''`"
 *
 * A locale naming an `Object.prototype` member stops being a HIT on that limb —
 * it does not abort the resolution. The `??` chain therefore continues to the
 * next limb exactly as it would for any other unknown tag, so
 * `pickLocalized({ en: 'Pricing' }, 'constructor')` is `'Pricing'` (limb 5), not
 * `''`. `''` is only correct when NO limb hits, which needs a map with no usable
 * entry at all. Both are pinned below, because a test that demanded `''` for the
 * first case would be pinning a fallthrough bug rather than this fix.
 */
describe('pickLocalized — own properties only (objectui#3907)', () => {
  /** Every `Object.prototype` member the card enumerates. */
  const PROTOTYPE_MEMBERS = [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
  ] as const;

  it.each(PROTOTYPE_MEMBERS)(
    'a locale named %s misses every limb instead of resolving up the prototype chain',
    (member) => {
      // Before the fix this returned the member's source text, e.g.
      // 'function Object() { [native code] }', as the rendered label.
      expect(pickLocalized({ en: 'Pricing' }, member)).toBe('Pricing');
    },
  );

  it.each(PROTOTYPE_MEMBERS)(
    'a locale named %s never leaks a function body into the label',
    (member) => {
      // Stated once over the whole set rather than per member: an
      // implementation that resolved a DIFFERENT prototype member would satisfy
      // no assertion above but would also fail none of them.
      expect(pickLocalized({ en: 'Pricing' }, member)).not.toContain('native code');
      expect(pickLocalized({ ja: '価格' }, member)).not.toContain('native code');
    },
  );

  it('the prototype limb is a miss, so the chain continues to the next limb', () => {
    // Limb 5 (`en`) is what answers above. With no `en`, the last-resort limb
    // answers; with nothing usable at all, and only then, the answer is `''`.
    expect(pickLocalized({ ja: '価格' }, 'constructor')).toBe('価格');
    expect(pickLocalized({ default: 'D' }, 'toString')).toBe('D');
    expect(pickLocalized({}, 'constructor')).toBe('');
  });

  it('own keys that happen to be named like prototype members still resolve', () => {
    // The guard is `hasOwnProperty`, not a denylist of names: an author who
    // really wrote such a key gets it back. No BCP-47 tag looks like this, but
    // a denylist-shaped fix would answer differently here and that difference
    // is worth pinning.
    expect(pickLocalized({ constructor: 'Ctor', en: 'Pricing' }, 'constructor')).toBe('Ctor');
    expect(pickLocalized({ toString: 'Str', en: 'Pricing' }, 'toString')).toBe('Str');
  });

  it('a map with a null prototype resolves identically to a plain object', () => {
    const nullProto = Object.assign(Object.create(null), { en: 'Pricing' }) as Record<string, unknown>;
    expect(pickLocalized(nullProto, 'constructor')).toBe('Pricing');
    expect(pickLocalized(nullProto, 'en')).toBe('Pricing');
  });
});

describe('pickLocalized — only `string` values are eligible, on every limb (objectui#3907)', () => {
  // Off-spec input: the framework's `InlineLocaleMapSchema` is
  // `z.record(<tag>, z.string())`, so nothing in contract can hold these. The
  // renderer must still not paint '[object Object]' onto a screen — a
  // non-string value is treated as absent and the limb misses.

  it('limb 1 (exact tag): a non-string value falls through instead of stringifying', () => {
    expect(pickLocalized({ 'zh-CN': { nested: 'x' }, en: 'Pricing' }, 'zh-CN')).toBe('Pricing');
  });

  it('limb 2 (base language): a non-string value falls through', () => {
    expect(pickLocalized({ zh: { nested: 'x' }, en: 'Pricing' }, 'zh-CN')).toBe('Pricing');
  });

  it('limb 4 (`default`): a non-string value falls through', () => {
    expect(pickLocalized({ default: { nested: 'x' }, ja: '価格' }, 'fr')).toBe('価格');
  });

  it('limb 5 (`en`): a non-string value falls through', () => {
    expect(pickLocalized({ en: { nested: 'x' }, ja: '価格' }, 'fr')).toBe('価格');
  });

  it('never renders the stringified object on any limb', () => {
    const offSpec = [
      [{ 'zh-CN': { n: 1 }, en: 'Pricing' }, 'zh-CN'],
      [{ zh: { n: 1 }, en: 'Pricing' }, 'zh-CN'],
      [{ default: { n: 1 }, ja: '価格' }, 'fr'],
      [{ en: { n: 1 }, ja: '価格' }, 'fr'],
      [{ 'zh-CN': [1, 2], en: 'Pricing' }, 'zh-CN'],
      [{ en: { n: 1 } }, 'fr'],
    ] as const;
    for (const [map, locale] of offSpec) {
      expect(pickLocalized(map, locale)).not.toBe('[object Object]');
    }
  });

  it('an off-spec value on every limb at once is a miss, not a stringified object', () => {
    expect(pickLocalized({ en: { n: 1 }, ja: { n: 2 } }, 'fr')).toBe('');
  });

  it('an empty-string value is still a hit — `""` is a label the author wrote', () => {
    // The boundary the string filter must not cross: `''` is a string, so the
    // limb hits and the chain stops. Pinned because a truthiness-based filter
    // would pass every test above and break exactly this.
    expect(pickLocalized({ en: '', 'zh-CN': '定价' }, 'en')).toBe('');
    expect(pickLocalized({ en: '' }, 'fr')).toBe('');
    expect(pickLocalized({ 'zh-CN': '' }, 'zh')).toBe('');
  });

  it('numeric and boolean VALUES are not labels (they were stringified before)', () => {
    // Distinct from a scalar passed as the whole `value`, which is still
    // stringified by design — asserted in the controls below.
    expect(pickLocalized({ en: 42, ja: '価格' }, 'fr')).toBe('価格');
    expect(pickLocalized({ en: true, ja: '価格' }, 'fr')).toBe('価格');
    expect(pickLocalized({ en: null, ja: '価格' }, 'fr')).toBe('価格');
  });
});

describe('pickLocalized — controls: every real language tag is byte-identical (objectui#3907)', () => {
  /** `[map, locale, the string this resolved to BEFORE the #3907 guards]` */
  const UNCHANGED: ReadonlyArray<readonly [Record<string, unknown>, string | undefined, string]> = [
    // Limb 1 — exact tag.
    [{ en: 'Pricing', 'zh-CN': '定价' }, 'zh-CN', '定价'],
    [{ en: 'Pricing', 'zh-CN': '定价' }, 'en', 'Pricing'],
    [{ en: 'Pricing', 'zh-CN': '定价' }, '  zh-CN  ', '定价'],
    // Limb 2 — base language.
    [{ en: 'Pricing', zh: '定价' }, 'zh-CN', '定价'],
    [{ en: 'Pricing', zh: '定价' }, 'zh-Hans-CN', '定价'],
    [{ zh: '基础', 'zh-CN': '区域' }, 'zh', '基础'],
    // Limb 3 — a regional key sharing the base.
    [{ en: 'Pricing', 'zh-CN': '定价' }, 'zh', '定价'],
    [{ en: 'Pricing', 'zh-CN': '定价' }, 'zh-TW', '定价'],
    [{ 'pt-BR': 'Preços' }, 'pt-PT', 'Preços'],
    [{ 'zh-TW': '區域', 'zh-CN': '区域' }, 'zh', '區域'],
    // Limb 4 — `default` outranks `en`.
    [{ default: 'D', en: 'E' }, 'fr', 'D'],
    // Limb 5 — `en`.
    [{ en: 'E', ja: 'J' }, 'fr', 'E'],
    [{ en: 'E', 'zh-CN': 'Z' }, undefined, 'E'],
    [{ en: 'E', 'zh-CN': 'Z' }, '', 'E'],
    // Limb 6 — last resort, in key order.
    [{ ja: 'J' }, 'fr', 'J'],
    [{ ja: 'J', ko: 'K' }, 'fr', 'J'],
    // The language subtag's case still matters; the region's still does not.
    [{ 'zh-CN': '定价' }, 'zh-cn', '定价'],
    [{ 'zh-CN': '定价', en: 'Pricing' }, 'ZH-CN', 'Pricing'],
    // Misses.
    [{}, 'en', ''],
    [{}, undefined, ''],
  ];

  it.each(UNCHANGED)('resolves %j at locale %j to %j, exactly as before', (map, locale, expected) => {
    expect(pickLocalized(map, locale)).toBe(expected);
  });

  it('the non-map forms are untouched', () => {
    expect(pickLocalized('Pricing', 'zh-CN')).toBe('Pricing');
    expect(pickLocalized('', 'zh-CN')).toBe('');
    expect(pickLocalized(null, 'zh')).toBe('');
    expect(pickLocalized(undefined, 'zh')).toBe('');
    // A scalar passed as the whole value is still stringified — that is the
    // documented pass-through, and it is NOT what the value filter governs.
    expect(pickLocalized(42, 'en')).toBe('42');
    expect(pickLocalized(true, 'en')).toBe('true');
  });
});

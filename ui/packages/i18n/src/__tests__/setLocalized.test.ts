/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `setLocalized` — the write-side inverse of `pickLocalized` (objectui#5301).
 *
 * A single-line authoring input can hold exactly one locale's string. Writing
 * that string back as the WHOLE value is the data-loss shape this function
 * exists to remove: `{ en: 'Revenue', 'zh-CN': '收入' }` becomes `'Revenue'` and
 * the Chinese title is gone, silently, with no failure signal anywhere.
 *
 * Two properties carry the whole contract, and both are pinned below:
 *
 *  1. **Every other locale survives.** The result differs from the input in at
 *     most one entry.
 *  2. **The entry written is the entry displayed** — for any map and any
 *     language, `pickLocalized(setLocalized(map, lang, s), lang) === s`. This is
 *     the pairing that stops the two functions drifting apart: if a write ever
 *     lands somewhere `pickLocalized` does not read, the author's "saved" string
 *     disappears on the next open while a stale one shows in its place.
 *
 * The one place the two deliberately DISAGREE is the tail of the chain, and
 * that asymmetry is the point rather than an oversight: `pickLocalized` falls
 * back through `default` -> `en` -> first value to find something to SHOW, and
 * none of those may be a write target. An author editing in `fr` a map with no
 * French entry is looking at the English string; writing there would overwrite
 * English with French. The write adds an `fr` entry instead.
 */

import { describe, it, expect } from 'vitest';
import { pickLocalized, setLocalized } from '../pickLocalized';

describe('setLocalized — values with no map to preserve', () => {
  it('returns the new string for a plain-string label', () => {
    expect(setLocalized('Revenue', 'en', 'Turnover')).toBe('Turnover');
  });

  it('returns the new string for a null/undefined label', () => {
    expect(setLocalized(null, 'en', 'Turnover')).toBe('Turnover');
    expect(setLocalized(undefined, 'zh-CN', '营收')).toBe('营收');
  });

  it('returns the new string for an array (not an inline locale map)', () => {
    expect(setLocalized(['Revenue'], 'en', 'Turnover')).toBe('Turnover');
  });
});

describe('setLocalized — the edited entry, and only the edited entry', () => {
  it('replaces the exact language tag and preserves the rest', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入', ja: '収益' };
    expect(setLocalized(stored, 'zh-CN', '营收')).toEqual({
      en: 'Revenue',
      'zh-CN': '营收',
      ja: '収益',
    });
  });

  it('never mutates the stored map', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入' };
    setLocalized(stored, 'zh-CN', '营收');
    expect(stored).toEqual({ en: 'Revenue', 'zh-CN': '收入' });
  });

  it('writes the BASE entry when that is the one displayed (zh-CN -> zh)', () => {
    // `pickLocalized({ en, zh }, 'zh-CN')` shows the `zh` entry, so that is the
    // entry the author edited.
    expect(setLocalized({ en: 'Revenue', zh: '收入' }, 'zh-CN', '营收')).toEqual({
      en: 'Revenue',
      zh: '营收',
    });
  });

  it('writes the REGIONAL entry when that is the one displayed (zh -> zh-CN)', () => {
    // The alternative — adding a bare `zh` key — would leave the edited-away
    // `zh-CN: '收入'` in the stored map: invisible in the panel that just
    // changed it, still live for any consumer asking for `zh-CN`.
    expect(setLocalized({ en: 'Revenue', 'zh-CN': '收入' }, 'zh', '营收')).toEqual({
      en: 'Revenue',
      'zh-CN': '营收',
    });
  });

  it('prefers the exact tag over the base and the regional sibling', () => {
    expect(setLocalized({ zh: '基础', 'zh-CN': '区域' }, 'zh', 'X')).toEqual({
      zh: 'X',
      'zh-CN': '区域',
    });
  });

  it('treats a non-string entry as no entry and overwrites it', () => {
    // `pickLocalized` skips a non-string entry, so nothing readable is lost.
    expect(setLocalized({ en: 42, fr: 'Revenu' }, 'en', 'Revenue')).toEqual({
      en: 'Revenue',
      fr: 'Revenu',
    });
  });
});

describe('setLocalized — a locale the map does not carry ADDS an entry', () => {
  it('never overwrites the `en` entry the display fell back to', () => {
    expect(setLocalized({ en: 'Revenue' }, 'fr', 'Revenu')).toEqual({
      en: 'Revenue',
      fr: 'Revenu',
    });
  });

  it('never overwrites the `default` entry the display fell back to', () => {
    expect(setLocalized({ default: 'Revenue', ja: '収益' }, 'fr', 'Revenu')).toEqual({
      default: 'Revenue',
      ja: '収益',
      fr: 'Revenu',
    });
  });

  it('never overwrites the first-value entry the display fell back to', () => {
    expect(setLocalized({ ja: '収益' }, 'fr', 'Revenu')).toEqual({
      ja: '収益',
      fr: 'Revenu',
    });
  });

  it('treats an absent language as `en`, matching pickLocalized', () => {
    expect(setLocalized({ ja: '収益' }, undefined, 'Revenue')).toEqual({
      ja: '収益',
      en: 'Revenue',
    });
  });
});

/**
 * objectui#3907 narrowed every `pickLocalized` limb to OWN properties and
 * `string` values. The write-key resolution follows, for the same reason: a tag
 * naming an `Object.prototype` member is not an entry, so it cannot be the
 * entry the author edited — the write adds a real own property instead of
 * appearing to overwrite an inherited one.
 */
describe('setLocalized — own properties only (objectui#3907 parity)', () => {
  const PROTOTYPE_MEMBERS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];

  for (const member of PROTOTYPE_MEMBERS) {
    it(`adds an own \`${member}\` entry rather than resolving against the prototype`, () => {
      const out = setLocalized({ en: 'Revenue' }, member, 'X') as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(out, member)).toBe(true);
      expect(out[member]).toBe('X');
      expect(out.en).toBe('Revenue');
      // And the pairing still holds for the odd tag.
      expect(pickLocalized(out, member)).toBe('X');
    });
  }
});

/**
 * The invariant that makes the pair safe to co-locate: whatever `setLocalized`
 * writes for a language, `pickLocalized` reads back for that same language.
 * Any future edit to either function's limb order that breaks the pairing fails
 * here rather than in a user's stored metadata.
 */
describe('setLocalized ∘ pickLocalized — what you write is what you read', () => {
  const CASES: Array<[string, unknown, string | undefined]> = [
    ['exact tag', { en: 'Revenue', 'zh-CN': '收入' }, 'zh-CN'],
    ['base fallback', { en: 'Revenue', zh: '收入' }, 'zh-CN'],
    ['regional upgrade', { en: 'Revenue', 'zh-CN': '收入' }, 'zh'],
    ['exact over base', { zh: '基础', 'zh-CN': '区域' }, 'zh'],
    ['no entry, en present', { en: 'Revenue' }, 'fr'],
    ['no entry, default present', { default: 'Revenue' }, 'fr'],
    ['no entry, single foreign entry', { ja: '収益' }, 'fr'],
    ['empty map', {}, 'de'],
    ['absent language', { ja: '収益' }, undefined],
    ['plain string', 'Revenue', 'zh-CN'],
    ['nullish', undefined, 'zh-CN'],
  ];

  for (const [name, stored, language] of CASES) {
    it(`round-trips the written string for: ${name}`, () => {
      const written = setLocalized(stored, language, 'WRITTEN');
      expect(pickLocalized(written, language)).toBe('WRITTEN');
    });
  }

  it('keeps every untouched entry byte-identical across a write', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入', ja: '収益', default: 'Revenue' };
    const written = setLocalized(stored, 'ja', '売上') as Record<string, unknown>;
    for (const key of ['en', 'zh-CN', 'default'] as const) {
      expect(written[key]).toBe(stored[key]);
    }
    expect(Object.keys(written)).toEqual(Object.keys(stored));
  });
});

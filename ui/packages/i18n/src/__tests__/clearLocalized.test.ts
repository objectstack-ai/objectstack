/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `clearLocalized` — the CLEAR arm of the single-locale editor (objectui#9274).
 *
 * `setLocalized` answers "type" and "retype". It cannot answer "clear": passing
 * it `''` stores an entry that claims the active locale HAS a title and it is
 * blank, which then shadows every display fallback `pickLocalized` would have
 * offered. The alternative an authoring surface reaches for by reflex —
 * dropping the whole value — is the objectui#9274 data loss arriving through
 * the clearing door instead of the typing door.
 *
 * Three properties carry the contract:
 *
 *  1. **Exactly one entry leaves.** Every other locale survives byte-identical.
 *  2. **The entry removed is the entry displayed** — it is chosen by the same
 *     `localeWriteKey` limbs `setLocalized` writes through, so an author can
 *     only ever clear the string they were actually looking at.
 *  3. **A borrowed string cannot be cleared.** When the map has no entry for the
 *     active locale the box was showing another locale's string as a display
 *     fallback; clearing it is a refusal, not a deletion.
 */

import { describe, it, expect } from 'vitest';
import { clearLocalized, setLocalized, pickLocalized } from '../pickLocalized.js';

describe('clearLocalized — non-map inputs have nothing localized to keep', () => {
  it.each([
    ['plain string', 'Revenue'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['array', ['Revenue']],
  ])('%s clears to undefined', (_label, value) => {
    expect(clearLocalized(value, 'en')).toBeUndefined();
  });
});

describe('clearLocalized — a map loses exactly the active locale entry', () => {
  it('removes the exact-tag entry and carries every other locale across', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入', ja: '収益' };
    const cleared = clearLocalized(stored, 'zh-CN') as Record<string, unknown>;
    expect(cleared).toEqual({ en: 'Revenue', ja: '収益' });
    expect(cleared.en).toBe(stored.en);
    expect(cleared.ja).toBe(stored.ja);
  });

  it('follows the base-language limb — `en-US` clears the stored `en` entry', () => {
    expect(clearLocalized({ en: 'Revenue', 'zh-CN': '收入' }, 'en-US')).toEqual({ 'zh-CN': '收入' });
  });

  it('follows the region-qualified limb — `zh` clears the stored `zh-CN` entry', () => {
    expect(clearLocalized({ en: 'Revenue', 'zh-CN': '收入' }, 'zh')).toEqual({ en: 'Revenue' });
  });

  it('does not mutate the stored map', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入' };
    clearLocalized(stored, 'en');
    expect(stored).toEqual({ en: 'Revenue', 'zh-CN': '收入' });
  });

  it('clearing the LAST entry yields undefined, never an empty map', () => {
    expect(clearLocalized({ en: 'Revenue' }, 'en')).toBeUndefined();
    expect(clearLocalized({ 'zh-CN': '收入' }, 'zh-CN')).toBeUndefined();
  });
});

describe('clearLocalized — a borrowed display fallback is refused, not deleted', () => {
  it('clearing under a locale with no entry returns the map unchanged', () => {
    // `pickLocalized` shows the `en` string under `fr`; clearing must not be
    // able to delete English on the strength of that loan.
    const stored = { en: 'Revenue', 'zh-CN': '收入' };
    expect(pickLocalized(stored, 'fr')).toBe('Revenue');
    expect(clearLocalized(stored, 'fr')).toEqual(stored);
  });

  it('the `default` and first-value limbs are not clear targets either', () => {
    const stored = { default: 'Revenue', 'zh-CN': '收入' };
    expect(pickLocalized(stored, 'fr')).toBe('Revenue');
    expect(clearLocalized(stored, 'fr')).toEqual(stored);
  });

  it('own properties only — a prototype member names no entry to clear', () => {
    const stored = { en: 'Revenue' };
    expect(clearLocalized(stored, 'constructor')).toEqual(stored);
  });
});

describe('clearLocalized — paired with setLocalized', () => {
  it('clear undoes the write it mirrors: set then clear restores the original map', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入' };
    for (const lang of ['en', 'en-US', 'zh-CN', 'zh'] as const) {
      const written = setLocalized(stored, lang, 'EDITED');
      expect(clearLocalized(written, lang)).toEqual(
        Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== pickLocalized(stored, lang))),
      );
    }
  });

  it('a locale ADDED by setLocalized can be cleared away again', () => {
    const stored = { en: 'Revenue' };
    const written = setLocalized(stored, 'ja', '売上');
    expect(written).toEqual({ en: 'Revenue', ja: '売上' });
    expect(clearLocalized(written, 'ja')).toEqual({ en: 'Revenue' });
  });

  it('non-string entries are carried across untouched, exactly as setLocalized does', () => {
    const stored = { en: 'Revenue', 'zh-CN': '收入', bogus: 42 } as Record<string, unknown>;
    expect(clearLocalized(stored, 'en')).toEqual({ 'zh-CN': '收入', bogus: 42 });
  });
});

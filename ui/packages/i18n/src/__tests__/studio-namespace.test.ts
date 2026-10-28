/**
 * The `studio` namespace (objectstack#25922, ruling 6431032267 Q2 = A): its
 * catalogues' own parity, and the two properties the ruling put on its shape.
 *
 *   1. PARITY, scoped to the namespace. Every `en` key has a `zh` row carrying
 *      the same `{placeholders}` (the designer's `tFormat()` syntax), and a
 *      `zh`-only key belongs to a documented family. This is the namespace's
 *      own section of the parity suite: `all-locales-key-parity.test.ts` does
 *      not read it — that suite iterates `builtInLocales`, the ten packs, and
 *      these catalogues are not packs — and `check:i18n-designer-parity`
 *      retired with the app-shell table (objectstack#25922 slice S7), so this
 *      section is the only parity check the namespace has.
 *   2. NOT IN THE EAGER CATALOGUE. No namespace key is defined by
 *      `locales/en.ts`, the console's one eager catalogue, so moving a key here
 *      adds nothing to the first load's translation bytes.
 *
 * The lazy runtime — `en` before the fetch, the fetch, the re-render — is
 * `studio-namespace-lazy.test.tsx`'s, in an isolated project: this file runs
 * in the `unit` project, which shares one module graph per worker, so "zh is
 * not resident yet" is not a state it can assume.
 */
import { describe, expect, it } from 'vitest';

import en from '../locales/en.js';
import STUDIO_EN from '../namespaces/studio/en.js';
import STUDIO_ZH from '../namespaces/studio/zh.js';
import {
  STUDIO_LANGUAGE_CODES,
  loadStudioCatalogue,
  resolveStudioLanguage,
  studioString,
} from '../namespaces/studio/index.js';
// The `zh`-only families, each one-sided on purpose; the list's one home.
import { STUDIO_ZH_ONLY_FAMILIES } from './studio-zh-only-families.js';

/** `tFormat()`'s own placeholder pattern (app-shell `views/metadata-admin/i18n.ts`). */
const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (value: string) => [...new Set(Array.from(value.matchAll(PLACEHOLDER), (m) => m[1]))].sort();

function flatKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe('studio namespace — scoped parity', () => {
  const enKeys = Object.keys(STUDIO_EN);
  const zhKeys = Object.keys(STUDIO_ZH);

  it('reads a populated catalogue (the comparisons below are not over nothing)', () => {
    expect(enKeys.length).toBeGreaterThan(0);
    expect(zhKeys.length).toBeGreaterThanOrEqual(enKeys.length);
  });

  it('every en key has a zh row', () => {
    expect(enKeys.filter((key) => !(key in STUDIO_ZH))).toEqual([]);
  });

  it('every shared key carries the same {placeholders} on both sides', () => {
    const mismatched = enKeys
      .filter((key) => key in STUDIO_ZH)
      .filter((key) => placeholders(STUDIO_EN[key]).join(' ') !== placeholders(STUDIO_ZH[key]).join(' '));
    expect(mismatched).toEqual([]);
  });

  it('a zh-only key belongs to a documented family', () => {
    const stray = zhKeys.filter(
      (key) => !(key in STUDIO_EN) && !STUDIO_ZH_ONLY_FAMILIES.some((family) => key.startsWith(family)),
    );
    expect(stray).toEqual([]);
  });

  it('every value is a non-empty string', () => {
    for (const catalogue of [STUDIO_EN, STUDIO_ZH]) {
      expect(Object.entries(catalogue).filter(([, v]) => typeof v !== 'string' || v.length === 0)).toEqual([]);
    }
  });
});

describe('studio namespace — outside the eager catalogue', () => {
  it('no namespace key is defined by locales/en.ts', () => {
    const eager = new Set(flatKeys(en));
    // Lit control: the flattening reaches real pack keys.
    expect(eager.has('common.save')).toBe(true);
    expect(Object.keys(STUDIO_EN).filter((key) => eager.has(key))).toEqual([]);
  });
});

describe('studio namespace — language resolution', () => {
  it('ships en and zh', () => {
    expect([...STUDIO_LANGUAGE_CODES].sort()).toEqual(['en', 'zh']);
  });

  it.each([
    ['zh-CN', 'zh'],
    ['zh', 'zh'],
    ['ZH-cn', 'zh'],
    ['zh-TW', 'zh'],
    ['en-US', 'en'],
    ['de', 'en'],
    ['ar-EG', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ])('%s is served by the %s catalogue', (lang, code) => {
    expect(resolveStudioLanguage(lang)).toBe(code);
  });

  it('a resident zh catalogue answers in zh; a third locale answers in en', async () => {
    await loadStudioCatalogue('zh');
    const key = Object.keys(STUDIO_EN).find((k) => STUDIO_ZH[k] !== STUDIO_EN[k])!;
    expect(studioString(key, 'zh-CN')).toBe(STUDIO_ZH[key]);
    expect(studioString(key, 'de')).toBe(STUDIO_EN[key]);
    expect(studioString(key, 'en-US')).toBe(STUDIO_EN[key]);
  });

  it('a key neither catalogue defines is undefined, never the key', () => {
    expect(studioString('designer.no.such.key', 'zh-CN')).toBeUndefined();
    expect(studioString('designer.no.such.key', 'de')).toBeUndefined();
  });
});

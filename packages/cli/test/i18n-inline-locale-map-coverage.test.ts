// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Inline `I18nLabel` maps are AUTHORED — the coverage gate must say so.
 *
 * #14749, maintainer ruling 2026-09-03, Q2 = **B1**: `check:i18n-coverage` and
 * the extractor stop recording a fully-written inline locale map under the
 * same diagnostic as a key the author never wrote. A map present at an
 * `I18nLabel`-typed prop is recorded as authored, its locales counted as
 * covered and its absent locales reported as gaps — without extracting it,
 * without a bundle row, and (Q3 = **C3**) without any key synthesised from a
 * node's path in the component tree.
 *
 * The defect had two faces, and both are pinned below because silencing only
 * the loud one would leave the quiet one reading as a clean gate:
 *
 *  - **quiet** — with no bundle entry anywhere, the key was filtered out of
 *    the expected set entirely (`inline === undefined` is what an ABSENT prop
 *    produces too), so a page localised into three languages was neither
 *    covered nor missing. It simply did not appear.
 *  - **loud** — with a bundle entry for one locale, the key came back into the
 *    expected set carrying no inline evidence, so every locale the MAP held
 *    and the bundle did not was reported "missing translation" — about text
 *    the author had written out in full.
 *
 * ⛔ And the other half of the ruling, which is what keeps this from being a
 * check that was switched off: `describe('still reports the genuinely
 * unauthored case')` below. A gate that stops reporting something has to prove
 * it still reports the real thing — an untranslated plain string, a map that
 * omits a locale, and the shapes that only look like maps.
 */

import { describe, it, expect } from 'vitest';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { computeI18nCoverage, inlineLocaleText } from '../src/utils/i18n-coverage.js';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';

const LOCALES = ['en', 'zh-CN', 'ja-JP'];

/** Every locale of `key` that the report does NOT count as translated. */
function gaps(report: ReturnType<typeof computeI18nCoverage>, key: string): string[] {
  return report.issues.filter((i) => i.key === key).map((i) => i.locale).sort();
}

/**
 * The keys the walker emits for `config` — the "quiet face" is a key that is
 * simply not in this list, so a coverage report showing no issue for it is
 * ambiguous on its own and every quiet-face assertion below reads it here.
 */
function walkedKeys(config: any): string[] {
  return collectExpectedEntries(config).map((e) => e.path.join('.'));
}

// ─── Fixtures ──────────────────────────────────────────────────────────

/**
 * A page whose ONLY localisation is inline locale maps — the shape #14412 /
 * #5728 / #10926 ruled is a legitimate, delivered localisation route. No
 * bundle, no `translations` block: nothing but the maps the author wrote.
 */
const pageLocalisedInlineOnly = (): any => ({
  i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
  pages: [
    {
      name: 'member_directory',
      label: { en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー' },
      regions: [
        {
          components: [
            {
              id: 'right_now',
              type: 'element:heading',
              properties: {
                title: { en: 'Right now', 'zh-CN': '此刻', 'ja-JP': '現在' },
              },
            },
          ],
        },
      ],
    },
  ],
});

/**
 * The loud face: an object field whose `help` is a map, plus a bundle that
 * authors the same key for `en` only. Before the ruling this reported `zh-CN`
 * and `ja-JP` as missing translations of a string that is written out in both.
 */
const fieldHelpMapWithEnBundle = (): any => ({
  i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
  objects: [
    {
      name: 'member',
      label: 'Member',
      fields: {
        email: {
          label: 'Email',
          help: { en: 'Work address', 'zh-CN': '工作邮箱', 'ja-JP': '勤務先メール' },
        },
      },
    },
  ],
  translations: [
    { en: { objects: { member: { fields: { email: { help: 'Work address' } } } } } },
  ],
});

// ─── The false report goes ─────────────────────────────────────────────

describe('an inline locale map is authored text (#14749 B1)', () => {
  it('quiet face: a page localised only by inline maps is COUNTED, not skipped', () => {
    const report = computeI18nCoverage(pageLocalisedInlineOnly(), { locales: LOCALES });

    // The key EXISTS — the half a "no issues" assertion cannot distinguish
    // from the key having been dropped, which is exactly what used to happen.
    expect(walkedKeys(pageLocalisedInlineOnly())).toContain('pages.member_directory.label');

    // …and is covered in every locale the map carries.
    expect(gaps(report, 'pages.member_directory.label')).toEqual([]);

    // Counting it as covered — not merely declining to report it — is
    // observable as a rise in `expectedKeys` against the same page with the
    // maps removed. (The absolute number also carries the platform
    // metadataForms baseline, which is why the assertion is a DELTA.)
    const stripped = pageLocalisedInlineOnly();
    delete stripped.pages[0].label;
    delete stripped.pages[0].regions[0].components[0].properties.title;
    const before = computeI18nCoverage(stripped, { locales: LOCALES }).totals.expectedKeys;
    expect(report.totals.expectedKeys).toBe(before + 2);
  });

  it('quiet face: the per-component key is counted too', () => {
    const report = computeI18nCoverage(pageLocalisedInlineOnly(), { locales: LOCALES });
    expect(gaps(report, 'pages.member_directory.components.right_now.title')).toEqual([]);

    expect(walkedKeys(pageLocalisedInlineOnly()))
      .toContain('pages.member_directory.components.right_now.title');
  });

  it('loud face: no "missing translation" for a locale the map holds', () => {
    const report = computeI18nCoverage(fieldHelpMapWithEnBundle(), { locales: LOCALES });
    // Before the ruling: ['ja-JP', 'zh-CN'] — reported missing while written.
    expect(gaps(report, 'objects.member.fields.email.help')).toEqual([]);
  });

  it('the walker records the map itself, not a flattened string', () => {
    const entry = collectExpectedEntries(pageLocalisedInlineOnly())
      .find((e) => e.path.join('.') === 'pages.member_directory.label');
    expect(entry).toBeDefined();
    expect(entry!.inlineLocales).toEqual({ en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー' });
    // `inline` is a PLAIN-STRING reading and stays unset — the two axes answer
    // different questions and neither stands in for the other.
    expect(entry!.inline).toBeUndefined();
  });
});

// ─── …without extracting anything (Q3 = C3) ────────────────────────────

describe('the map is still never extracted (#14749 C3)', () => {
  it('scaffolds no bundle row for a map, in any locale', () => {
    const result = extractTranslations(pageLocalisedInlineOnly(), {
      defaultLocale: 'en',
      locales: LOCALES,
    });
    for (const locale of LOCALES) {
      const pages = (result.bundles[locale] as any)?.pages;
      expect(pages?.member_directory, `bundle row for ${locale}`).toBeUndefined();
    }
  });

  it('never seeds a bundle with the MAP OBJECT itself', () => {
    // The derived-seed sites read `x.label ?? fallback`, which is truthy for a
    // map — so the seed handed to `setDeep` was the map OBJECT, and a bundle
    // written from it carried a nested locale record where a translator
    // expects a string. Same defect class, one expression over: a map used
    // where only a plain string was ever meant.
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      objects: [{ name: 'member', label: 'Member', fields: {} }],
      views: [{
        name: 'all_members',
        objectName: 'member',
        label: { en: 'All members', 'zh-CN': '全部成员', 'ja-JP': '全メンバー' },
      }],
    };
    const seed = collectExpectedEntries(config)
      .find((e) => e.path.join('.') === 'objects.member._views.all_members.label')?.sourceValue;
    expect(typeof seed === 'string' || seed === undefined, `seed was ${typeof seed}`).toBe(true);

    const bundle: any = extractTranslations(config, { defaultLocale: 'en', locales: LOCALES })
      .bundles.en;
    const written = bundle?.objects?.member?._views?.all_members?.label;
    expect(written === undefined || typeof written === 'string', `bundle held ${typeof written}`)
      .toBe(true);
  });

  it('invents no node-path key — every emitted key is name- or id-addressed', () => {
    for (const key of walkedKeys(pageLocalisedInlineOnly())) {
      // A node-path scheme is what an array index in a key looks like
      // (`…components.0.title`). ⛔ Ruled out by name: a sibling reorder would
      // silently swap two translations with every gate green.
      expect(key.split('.').every((seg) => !/^\d+$/.test(seg)), key).toBe(true);
    }
  });
});

// ─── …and the genuine gap is still reported ────────────────────────────

describe('still reports the genuinely unauthored case', () => {
  it('a plain-string label with no bundle is still missing in every other locale', () => {
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      pages: [{ name: 'member_directory', label: 'Members' }],
    };
    const report = computeI18nCoverage(config, { locales: LOCALES });
    expect(gaps(report, 'pages.member_directory.label')).toEqual(['ja-JP', 'zh-CN']);
  });

  it('a PARTIAL map still reports the locale it omits', () => {
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      pages: [{ name: 'member_directory', label: { en: 'Members', 'zh-CN': '成员' } }],
    };
    const report = computeI18nCoverage(config, { locales: LOCALES });
    expect(gaps(report, 'pages.member_directory.label')).toEqual(['ja-JP']);
  });

  it('an EMPTY map is not authoring — it stays out of the expected set', () => {
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      pages: [{ name: 'member_directory', label: {} }],
    };
    expect(walkedKeys(config)).not.toContain('pages.member_directory.label');
  });

  it('an empty-string entry is not a translation, on either side', () => {
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      pages: [{ name: 'member_directory', label: { en: 'Members', 'zh-CN': '', 'ja-JP': '  ' } }],
    };
    const report = computeI18nCoverage(config, { locales: LOCALES });
    // `''` is dropped; `'  '` is a string an author wrote and is kept — the
    // same rule `lookupKey` applies to a bundle value.
    expect(gaps(report, 'pages.member_directory.label')).toEqual(['zh-CN']);
  });

  it('the retired `{ key, defaultValue }` dialect is NOT laundered into "authored"', () => {
    // `InlineLocaleMapSchema` refuses those two names (#5055 / #9925 / #10492)
    // because both resolvers would render the raw i18n key on screen. The
    // walker asks that schema rather than pattern-matching, so the refusal
    // holds here too instead of being re-decided.
    const config: any = {
      i18n: { defaultLocale: 'en', supportedLocales: LOCALES },
      pages: [{ name: 'member_directory', label: { key: 'pages.members.label', defaultValue: 'Members' } }],
    };
    expect(walkedKeys(config)).not.toContain('pages.member_directory.label');
  });
});

// ─── Parity with the renderer's own rule ───────────────────────────────

describe('coverage reads the map the way the renderer does', () => {
  /**
   * Whenever this file says a locale is covered, the shared resolver — pinned
   * limb for limb to objectui's `pickLocalized` — really shows that entry. So
   * "covered" means "this reader sees this translation", never "some string
   * exists in the map".
   */
  const maps: Array<Record<string, string>> = [
    { en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー' },
    { en: 'Members', zh: '成员' },
    { 'zh-CN': '成员' },
    { default: 'Members', 'zh-CN': '成员' },
    { en: 'Members' },
  ];
  const locales = ['en', 'zh', 'zh-CN', 'zh-TW', 'ja-JP', 'es-ES'];

  it('a covered locale is the entry the renderer picks', () => {
    for (const map of maps) {
      for (const locale of locales) {
        const covered = inlineLocaleText(map, locale);
        if (covered === undefined) continue;
        expect(resolveI18nLabel(map, locale), `${JSON.stringify(map)} @ ${locale}`).toBe(covered);
      }
    }
  });

  it('⛔ the FALLBACK limbs are not coverage — that is what a gap looks like', () => {
    // The renderer answers for all three (it falls through to `en` /
    // `default` / the first value); the gate must not, or a map would cover
    // every locale on earth the moment it exists.
    expect(resolveI18nLabel({ en: 'Members' }, 'ja-JP')).toBe('Members');
    expect(inlineLocaleText({ en: 'Members' }, 'ja-JP')).toBeUndefined();

    expect(resolveI18nLabel({ default: 'Members' }, 'ja-JP')).toBe('Members');
    expect(inlineLocaleText({ default: 'Members' }, 'ja-JP')).toBeUndefined();
  });

  it('same language, other region, counts — limb 3 of the shared rule', () => {
    expect(inlineLocaleText({ 'zh-CN': '成员' }, 'zh-TW')).toBe('成员');
    expect(inlineLocaleText({ zh: '成员' }, 'zh-CN')).toBe('成员');
  });
});

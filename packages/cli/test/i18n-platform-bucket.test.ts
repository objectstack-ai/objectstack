// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os i18n check` counts the coverage of the strings the stack under
 * examination actually OWNS.
 *
 * ## What was wrong
 *
 * `collectExpectedEntries` walks the Studio metadata-form registries
 * unconditionally — identically for every config, an empty one included — so
 * every stack's expected set carries ~773 `metadataForms.*` keys that
 * `@objectstack/platform-objects` translates and the runtime serves. `os lint`
 * has always known those are not the author's: it hides them and says so
 * ("platform built-ins: 773 i18n issue(s) hidden — rerun with
 * --include-platform"). `os i18n extract` has always known: `--no-metadata-forms`.
 * `os i18n check` did not, and it is the one command that publishes a
 * PERCENTAGE, so the baseline sat in its denominator:
 *
 *     Coverage by locale
 *       en       ████████████████████████ 100.0%  (1265/1265, missing 0)
 *       zh-CN    █████████░░░░░░░░░░░░░░░  38.9%  (492/1265, missing 773)
 *
 * — an application with every key it owns translated, reading 38.9%. That made
 * `--strict` and `--threshold`, whose entire purpose is CI gating, unusable for
 * an app package. The only way to move the number was to ship a copy of the
 * platform's bundle, which would override the platform's own and go stale at
 * the next upgrade: the workaround is worse than the defect.
 *
 * ## Why ownership is OBSERVED and not simply excluded
 *
 * An unconditional exclusion turns the app side green by deleting the gate on
 * the side that does own those strings. `platform-objects`' extract config
 * carries `metadataForms` in every locale bundle it declares, and its coverage
 * number is a real number about real work — so the negative control below is
 * as load-bearing as the main case: THE PLATFORM PACKAGE MUST STILL BE GATED,
 * and without passing a flag, because "the third command should not require an
 * author to discover a flag" is the whole point of the repair.
 *
 * ## No absolute counts
 *
 * The baseline's size moves whenever a metadata type or a form field is added.
 * A pin on 773 would red on unrelated work and, worse, would go green again if
 * the family were dropped to zero — the regression it exists to catch. So every
 * assertion here is a RELATION between two runs of the same fixture, and every
 * "none of these" has a run of the same fixture that produces them.
 */

import { describe, it, expect } from 'vitest';
import { Parser } from '@oclif/core';
import {
  computeI18nCoverage,
  stackAuthorsMetadataForms,
  type CoverageReport,
} from '../src/utils/i18n-coverage.js';
import { foldCoverageIssues } from '../src/commands/lint.js';
import I18nCheck from '../src/commands/i18n/check.js';

const LOCALE = 'zh-CN';

/** An ordinary application: its own object, no platform bundle of any kind. */
function appStack(): any {
  return {
    i18n: { defaultLocale: 'en', supportedLocales: ['en', LOCALE] },
    objects: [
      { name: 'inquiry', label: 'Inquiry', fields: { name: { label: 'Name' } } },
    ],
  };
}

/**
 * The same application with its own surface fully translated — the reporter's
 * situation exactly, and the one where the old denominator was visible as a
 * percentage rather than as a key list.
 */
function fullyTranslatedAppStack(): any {
  return {
    ...appStack(),
    translations: [
      { [LOCALE]: { objects: { inquiry: { label: '咨询', fields: { name: { label: '姓名' } } } } } },
    ],
  };
}

/**
 * A stack shaped like `packages/platform-objects/scripts/i18n-extract.config.ts`:
 * it SHIPS the metadata-form baseline, so the baseline is its own work.
 * Deliberately partial — ownership is a claim about who translates the family,
 * not a claim to have finished.
 */
function platformStack(): any {
  return {
    i18n: { defaultLocale: 'en', supportedLocales: ['en', LOCALE] },
    objects: [{ name: 'sys_user', label: 'User', fields: { name: { label: 'Name' } } }],
    translations: [
      { en: { metadataForms: { object: { label: 'Object' } } } },
      { [LOCALE]: { metadataForms: { object: { label: '对象' } } } },
    ],
  };
}

const platformIssues = (r: CoverageReport) => r.issues.filter((i) => i.source === 'metadataForm');

describe('stackAuthorsMetadataForms — ownership is read off the bundles', () => {
  it('is false for an application that ships none', () => {
    expect(stackAuthorsMetadataForms(appStack())).toBe(false);
    expect(stackAuthorsMetadataForms(fullyTranslatedAppStack())).toBe(false);
    expect(stackAuthorsMetadataForms({})).toBe(false);
  });

  it('is true for a stack that ships the baseline', () => {
    expect(stackAuthorsMetadataForms(platformStack())).toBe(true);
  });

  it('reads an empty scaffold as NOT authored', () => {
    // `os i18n extract --fill=empty` leaves this behind before anyone
    // translates anything. Reading it as a claim of ownership would hand an app
    // the whole baseline on the strength of a placeholder.
    const scaffolded = {
      translations: [{ [LOCALE]: { metadataForms: { object: { label: '', fields: {} } } } }],
    };
    expect(stackAuthorsMetadataForms(scaffolded)).toBe(false);
    // Firing control: the same shape with one real string is authored.
    const translated = {
      translations: [{ [LOCALE]: { metadataForms: { object: { label: '对象', fields: {} } } } }],
    };
    expect(stackAuthorsMetadataForms(translated)).toBe(true);
  });
});

describe('os i18n check — the platform baseline is out of an app’s denominator', () => {
  it('drops it by default, and the app’s own surface is what remains', () => {
    const config = appStack();
    const auto = computeI18nCoverage(config, { platformMetadataForms: 'auto' });
    const included = computeI18nCoverage(config, { platformMetadataForms: 'include' });

    expect(auto.platformMetadataForms.mode).toBe('excluded');
    expect(platformIssues(auto)).toHaveLength(0);
    // The firing control for that zero: the SAME fixture produces them when
    // the baseline is counted, so the empty list above is a decision and not
    // an inert assertion over a family this fixture never reaches.
    expect(platformIssues(included).length).toBeGreaterThan(0);

    expect(auto.totals.expectedKeys).toBeLessThan(included.totals.expectedKeys);
    expect(auto.platformMetadataForms.excludedKeys).toBe(
      included.totals.expectedKeys - auto.totals.expectedKeys,
    );
    expect(included.platformMetadataForms).toEqual({ mode: 'included', excludedKeys: 0 });
  });

  it('lets an app with its own surface translated reach 100%', () => {
    // The reporter's measurement, as a property: 38.9% became 100% without a
    // single new translation, because the 773 keys were never the app's.
    const config = fullyTranslatedAppStack();
    const auto = computeI18nCoverage(config, { platformMetadataForms: 'auto' });
    const included = computeI18nCoverage(config, { platformMetadataForms: 'include' });

    const pct = (r: CoverageReport) => r.stats.find((s) => s.locale === LOCALE)?.coveragePercent;
    expect(pct(auto)).toBe(100);
    expect(pct(included)).toBeLessThan(100);
    expect(auto.totals.errors).toBe(0);
  });

  it('⛔ still gates the package that SHIPS the baseline — no flag needed', () => {
    // Triage's negative control. An unconditional exclusion would make the app
    // side green by deleting this gate, so this case is what forbids that
    // implementation.
    const config = platformStack();
    const auto = computeI18nCoverage(config, { platformMetadataForms: 'auto' });

    expect(auto.platformMetadataForms).toEqual({ mode: 'included', excludedKeys: 0 });
    expect(platformIssues(auto).length).toBeGreaterThan(0);
    expect(auto.totals.expectedKeys).toBe(
      computeI18nCoverage(config, { platformMetadataForms: 'include' }).totals.expectedKeys,
    );
  });

  it('honours both explicit requests, against the fixture’s own default', () => {
    // `--include-platform` on an app that would otherwise be excluded …
    const app = computeI18nCoverage(appStack(), { platformMetadataForms: 'include' });
    expect(app.platformMetadataForms.mode).toBe('included');
    expect(platformIssues(app).length).toBeGreaterThan(0);

    // … and `--no-include-platform` on a stack that would otherwise be included.
    const platform = computeI18nCoverage(platformStack(), { platformMetadataForms: 'exclude' });
    expect(platform.platformMetadataForms.mode).toBe('excluded');
    expect(platform.platformMetadataForms.excludedKeys).toBeGreaterThan(0);
    expect(platformIssues(platform)).toHaveLength(0);
  });
});

describe('the shared seam keeps os lint whole', () => {
  it('counts the baseline when no caller asks otherwise', () => {
    // ⛔ The default at `computeI18nCoverage` stays `include`, and this is why:
    // `os lint` folds the family away one seam later, off
    // `CoverageIssue['source']`, and COUNTS what it folded for its own hint
    // line. Flipping the default here would zero that hint silently — the
    // issues would never be produced to be counted.
    const report = computeI18nCoverage(appStack());
    expect(report.platformMetadataForms).toEqual({ mode: 'included', excludedKeys: 0 });

    const { folded, hiddenPlatform } = foldCoverageIssues(report.issues, false);
    expect(hiddenPlatform).toBeGreaterThan(0);
    expect(folded.some((i) => i.rule === 'i18n/missing-metadataForm')).toBe(false);
    // Firing control: the same issues, asked for, do reach the report.
    expect(
      foldCoverageIssues(report.issues, true).folded.some((i) => i.rule === 'i18n/missing-metadataForm'),
    ).toBe(true);
  });
});

describe('the flag is the one os lint already publishes', () => {
  it('is spelled --include-platform and carries its negation', () => {
    // The card ranked "the same platform-bucket default `lint` has" ahead of
    // "at minimum the `--no-metadata-forms` switch". Sharing `lint`'s spelling
    // is the readable half of taking its default: an author who has met one of
    // these commands has met the other.
    const flag: any = (I18nCheck.flags as any)['include-platform'];
    expect(flag).toBeDefined();
    expect(flag.type).toBe('boolean');
    expect(flag.allowNo).toBe(true);
    // Absent ⇒ `auto`. A `default` here would erase the third state and with it
    // the observed-ownership behaviour every case above depends on.
    expect(flag.default).toBeUndefined();
  });

  it('parses as THREE states, through oclif’s own parser', () => {
    // Structural assertions above describe the declaration; this one describes
    // the behaviour an operator gets, and it is the half that decides whether
    // `auto` exists at all. Run against `I18nCheck.flags` itself — the object
    // the command hands oclif — so a later `default: false` reddens here rather
    // than silently collapsing the absent case onto `--no-include-platform`.
    // The published command is driven end to end in the sibling e2e file; this
    // is the part that need not spawn a process to be true.
    return Promise.all(
      ([
        [[], undefined],
        [['--include-platform'], true],
        [['--no-include-platform'], false],
      ] as Array<[string[], boolean | undefined]>).map(async ([argv, expected]) => {
        const parsed = await Parser.parse(argv, { flags: I18nCheck.flags as any, strict: true });
        expect((parsed.flags as any)['include-platform']).toBe(expected);
      }),
    );
  });
});

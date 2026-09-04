// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One translation key is ONE demand — the property, not the counts.
 *
 * `pnpm check:i18n-coverage` ratchets `countI18nRuleIssues`, which is `.length`
 * over the `i18n/`-prefixed findings, while its report calls that number
 * "untranslated declared strings". Those are the same number only if the
 * population holds each key once. It did not: two places in the walk addressed
 * one bundle slot, so 70 of 691 baselined units were one string counted twice
 * and translating ONE key moved the ratchet by TWO.
 *
 * These pins deliberately assert NO COUNT. A pin on 621, or on the per-config
 * 101 / 414 / 106, goes green again the day a third carrier is added to the
 * walk — the exact regression it would exist to catch. The property is what
 * cannot regress silently, so the property is what is pinned, at both seams the
 * defect was visible from:
 *
 *   1. `collectExpectedEntries` emits each path at most once (production), and
 *   2. no report carries two findings with the same `path` for one locale
 *      (reporting — `os lint` spells that path `translations.LOCALE.KEY`, in
 *      `commands/lint.ts`).
 *
 * Both measured duplicate families are exercised below, because they have
 * different causes and only one of them is visible in a report at all:
 *
 *   - Two carriers, one action. The normalizer attaches an object's actions to
 *     `obj.actions` AND to top-level `config.actions` — the same object
 *     reference, measured on all three baselined example configs — so both
 *     action branches emit `objects.OBJECT._actions.ACTION.*`.
 *   - Two declarations, one form field. `deleteBehavior` is declared twice in
 *     each of `field.form.ts` / `object.form.ts`, gated on `visibleWhen`; both
 *     render into one key. Config-independent — it duplicates six entries on an
 *     EMPTY config, and it never reaches `os lint`'s report, which hides the
 *     `metadataForms` bucket unless `--include-platform` is passed. A
 *     de-duplication at the reporting seam would have left this family
 *     duplicated in perpetuity, which is why the fix lives in the walker.
 */

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';

/** Repeated paths in a walk, as `[path, occurrences]`, occurrences > 1 only. */
function repeatedPaths(entries: ReadonlyArray<{ path: string[] }>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.path.join('.');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1);
}

/**
 * A config shaped the way the normalizer really emits one: the action object is
 * carried by BOTH the object and the top-level list, by reference. Sharing the
 * reference is the point — a copy would not reproduce the defect faithfully,
 * and a shared reference is what was measured on the real configs.
 */
function dualCarrierConfig(): any {
  const action = {
    name: 'convert_lead',
    label: 'Convert Lead',
    objectName: 'lead',
    confirmText: 'Convert?',
    successMessage: 'Converted.',
    params: [{ name: 'owner', label: 'New Owner' }],
  };
  return {
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    objects: [{ name: 'lead', label: 'Lead', fields: { name: { label: 'Name' } }, actions: [action] }],
    actions: [action],
    translations: [{ en: { objects: { lead: { label: 'Lead' } } } }],
  };
}

describe('one key is one demand: the i18n walk', () => {
  it('emits each expected path at most once, for a dual-carrier action', () => {
    expect(repeatedPaths(collectExpectedEntries(dualCarrierConfig()))).toEqual([]);
  });

  it('emits each expected path at most once on a config that declares nothing', () => {
    // Guards the registry-driven family (`metadataForms.*.fields.deleteBehavior.*`),
    // which is reached with no author metadata at all.
    expect(repeatedPaths(collectExpectedEntries({}))).toEqual([]);
  });

  it('still emits the action keys it collapsed: de-duplication drops copies, never demands', () => {
    const paths = collectExpectedEntries(dualCarrierConfig()).map((e) => e.path.join('.'));
    for (const key of [
      'objects.lead._actions.convert_lead.label',
      'objects.lead._actions.convert_lead.confirmText',
      'objects.lead._actions.convert_lead.successMessage',
      'objects.lead._actions.convert_lead.params.owner.label',
    ]) {
      expect(paths).toContain(key);
    }
  });

  it('keeps the FIRST emission when two declarations disagree about one path', () => {
    // Not reachable through the normalizer today (both carriers hold one
    // reference), so this pins the documented rule rather than a measurement.
    const config: any = {
      objects: [{ name: 'lead', label: 'Lead', actions: [{ name: 'act', label: 'From the object' }] }],
      actions: [{ name: 'act', objectName: 'lead', label: 'From the top level' }],
    };
    const entry = collectExpectedEntries(config).find(
      (e) => e.path.join('.') === 'objects.lead._actions.act.label',
    );
    expect(entry?.sourceValue).toBe('From the object');
  });

  it('reports the number of keys it actually wrote into the skeleton', () => {
    // The second consumer the duplicates lied to: `setDeep` collapsed them on
    // the way into the bundle while `counts` kept counting emissions, so
    // `os i18n extract` over-reported (measured: 1632 claimed against 1531
    // written, app-showcase).
    const result = extractTranslations(dualCarrierConfig(), { locales: ['en', 'zh-CN'] });
    const leaves = (node: any): number =>
      Object.values(node ?? {}).reduce<number>(
        (n, v) => n + (v !== null && typeof v === 'object' ? leaves(v) : 1),
        0,
      );
    expect(result.counts.en).toBe(leaves(result.bundles.en));
    expect(result.totalExpected).toBe(leaves(result.bundles.en));
  });
});

describe('one key is one demand: the coverage report', () => {
  it('carries no two findings with the same path for the same locale', () => {
    const report = computeI18nCoverage(dualCarrierConfig());
    // `os lint --json` spells a finding's path exactly this way.
    const paths = report.issues.map((i) => `translations.${i.locale}.${i.key}`);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('carries no duplicate path per locale over the platform bucket either', () => {
    // The `metadataForms` family is only reportable with `--include-platform`,
    // and it is the family a reporting-seam de-duplication could not see.
    const report = computeI18nCoverage(
      { i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] } },
      { locales: ['zh-CN'] },
    );
    const paths = report.issues.map((i) => `translations.${i.locale}.${i.key}`);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

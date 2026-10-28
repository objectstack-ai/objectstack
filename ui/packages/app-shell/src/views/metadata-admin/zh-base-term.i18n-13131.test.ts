// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13131 — zh-CN Studio home read "新建软件包(可写 base)": the English
 * word "base" (a writable package) was left untranslated. The zh table already
 * renders that sense as 基座 (`engine.package.writableRequired`,
 * `engine.packages.detail.duplicated` / `adopted`), so the fixed rows reuse it.
 *
 * The census walks every row of the designer strings' `zh` catalogue, so a row
 * added later is asked the same question. Those rows live in `@object-ui/i18n`'s
 * `studio` namespace since objectstack#25922 retired the app-shell table
 * (slice S7), and the census reads the loaded catalogue itself. Regex: the
 * whole Latin word `base`, case-insensitive, matched in the row VALUE only —
 * keys and identifiers such as `baseObject` (no word boundary) are out of scope.
 */

import { describe, it, expect } from 'vitest';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t } from './i18n';

/** The namespace's `zh` rows (objectstack#25922), resident before any case runs. */
const studioZh = await loadStudioCatalogue('zh');

function zhRows(): Array<[string, string]> {
  return Object.entries(studioZh);
}

const BARE_BASE = /\bbase\b/i;

describe('zh "base" (writable package) is translated — objectui#13131', () => {
  it('zh engine.studio.pkg.new carries no Latin word "base"', () => {
    const msg = t('engine.studio.pkg.new', 'zh');
    expect(msg).not.toMatch(BARE_BASE);
    expect(msg).toContain('基座');
  });

  it('census: no studio zh value carries the bare word "base"', () => {
    const rows = zhRows();
    // Positive control: the walk reaches the whole catalogue, including the fixed row.
    expect(rows.length).toBeGreaterThan(3000);
    expect(rows.map(([k]) => k)).toContain('engine.studio.pkg.new');
    const offenders = rows.filter(([, v]) => BARE_BASE.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('control: en engine.studio.pkg.new is unchanged', () => {
    expect(t('engine.studio.pkg.new', 'en')).toBe('New package (writable base)');
  });
});

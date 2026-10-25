// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13131 — zh-CN Studio home read "新建软件包(可写 base)": the English
 * word "base" (a writable package) was left untranslated. The zh table already
 * renders that sense as 基座 (`engine.package.writableRequired`,
 * `engine.packages.detail.duplicated` / `adopted`), so the fixed rows reuse it.
 *
 * The census walks every row of `ENGINE_STRINGS_ZH` as read from source (with
 * comments masked by the shared helper), so a row added later is asked the same
 * question. Regex: the whole Latin word `base`, case-insensitive, matched in the
 * row VALUE only — keys, identifiers such as `baseObject` (no word boundary)
 * and comments are out of scope.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';
import { t } from './i18n';

const mask: (source: string) => string = maskComments;
const here = path.dirname(fileURLToPath(import.meta.url));

function zhRows(): Array<[string, string]> {
  const source = mask(readFileSync(path.join(here, 'i18n.ts'), 'utf8'));
  const start = source.indexOf('const ENGINE_STRINGS_ZH');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  const block = source.slice(start, end);
  const rows: Array<[string, string]> = [];
  const row = /'((?:[^'\\\n]|\\.)*)'\s*:\s*'((?:[^'\\\n]|\\.)*)'/g;
  for (const m of block.matchAll(row)) rows.push([m[1], m[2]]);
  return rows;
}

const BARE_BASE = /\bbase\b/i;

describe('zh "base" (writable package) is translated — objectui#13131', () => {
  it('zh engine.studio.pkg.new carries no Latin word "base"', () => {
    const msg = t('engine.studio.pkg.new', 'zh');
    expect(msg).not.toMatch(BARE_BASE);
    expect(msg).toContain('基座');
  });

  it('census: no ENGINE_STRINGS_ZH value carries the bare word "base"', () => {
    const rows = zhRows();
    // Positive control: the walk reaches the whole table, including the fixed row.
    expect(rows.length).toBeGreaterThan(3000);
    expect(rows.map(([k]) => k)).toContain('engine.studio.pkg.new');
    const offenders = rows.filter(([, v]) => BARE_BASE.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('control: en engine.studio.pkg.new is unchanged', () => {
    expect(t('engine.studio.pkg.new', 'en')).toBe('New package (writable base)');
  });
});

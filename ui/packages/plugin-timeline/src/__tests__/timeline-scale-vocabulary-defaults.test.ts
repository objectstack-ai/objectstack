/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4520 — `generateTimeScaleHeaders` as a pure function: the translate
 * seam and its English last resort.
 *
 * ── Why this file mounts nothing ─────────────────────────────────────────
 * There is no React here at all — no `render`, no provider, not even an import
 * of one. That began as a workaround: the sibling
 * `timeline-scale-vocabulary.test.tsx` mounts an `I18nProvider` in every case,
 * and a mounted provider used to leave react-i18next's GLOBAL instance on its
 * own instance, so a provider-less assertion sharing that file resolved `'zh'`
 * and pinned test ordering instead of the fallback.
 *
 * objectui#4514 fixed the harness — `installI18nGlobalReset()` in
 * `vitest.setup.base.ts` restores the global after every test — so the split is
 * no longer load-bearing. It stays because a pure-function file that imports no
 * React is worth having on its own merits.
 *
 * ── What the seam is ─────────────────────────────────────────────────────
 * `generateTimeScaleHeaders` is a pure exported function, so it cannot host a
 * hook. objectui#4513 threaded the resolved `locale` string in as a parameter
 * with an `'en'` default; this card threads the translate fn the same way, for
 * the same reason and with the same shape — the default is the package's own
 * `TIMELINE_DEFAULT_TRANSLATIONS` table, which is exactly what
 * `createSafeTranslation` serves on a provider-less host. So an existing
 * 3- or 4-argument call site keeps producing byte-identical English.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * The English cases are GREEN on both sides of the fix by construction — the
 * `en` pack values are byte-identical to the retired `Week ${n}` /
 * `Q${q} ${year}` literals, which is the whole point of the must-not-change
 * half. The RED-first evidence here is the seam itself: before the change the
 * function takes no translate fn, so the 5th argument is silently dropped and
 * the explicit-`t` cases fail.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateTimeScaleHeaders } from '../renderer';
import { TIMELINE_DEFAULT_TRANSLATIONS } from '../useTimelineTranslation';

const AUG_11 = '2026-08-11T00:00:00';
const AUG_12 = '2026-08-12T00:00:00';
const SEP_11 = '2026-09-11T00:00:00';

describe('the English last resort is byte-identical to the retired literals', () => {
  it('the 3-argument week call still reads `Week n`', () => {
    expect(generateTimeScaleHeaders('week', AUG_11, AUG_12)).toEqual(['Week 1']);
    expect(generateTimeScaleHeaders('week', AUG_11, SEP_11)).toEqual([
      'Week 1',
      'Week 2',
      'Week 3',
      'Week 4',
      'Week 5',
    ]);
  });

  it('the 3-argument quarter call still reads `Qn YYYY` (the objectui#2942 pin)', () => {
    expect(generateTimeScaleHeaders('quarter', '2026-01-15', '2026-08-01')).toEqual([
      'Q1 2026',
      'Q2 2026',
      'Q3 2026',
    ]);
  });

  it('the year scale carries no vocabulary and is untouched', () => {
    expect(generateTimeScaleHeaders('year', '2025-06-01', '2027-01-01')).toEqual(['2025', '2026', '2027']);
  });

  it('the defaults table states those same two strings, so the seam has one source', () => {
    // If these drift, the provider-less host and the `en` provider render
    // different axes — the failure `createSafeTranslation` exists to prevent.
    expect(TIMELINE_DEFAULT_TRANSLATIONS['timeline.scale.week']).toBe('Week {{n}}');
    expect(TIMELINE_DEFAULT_TRANSLATIONS['timeline.scale.quarter']).toBe('Q{{quarter}} {{year}}');
    expect(TIMELINE_DEFAULT_TRANSLATIONS['timeline.gantt.rowLabel']).toBe('Items');
  });
});

describe('an explicit translate fn drives both bucket scales', () => {
  it('the week bucket asks the channel, and passes the number as a parameter', () => {
    const t = vi.fn((key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params)}`);
    const headers = generateTimeScaleHeaders('week', AUG_11, SEP_11, 'zh', t);

    expect(headers[0]).toBe('timeline.scale.week:{"n":1}');
    expect(headers[1]).toBe('timeline.scale.week:{"n":2}');
    // The number reaches the channel as DATA, never spliced into the key or
    // concatenated onto the returned string.
    expect(t).toHaveBeenCalledWith('timeline.scale.week', { n: 1 });
  });

  it('the quarter bucket passes the quarter and the year as separate parameters', () => {
    const t = vi.fn((key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params)}`);
    const headers = generateTimeScaleHeaders('quarter', '2026-11-15T00:00:00', '2027-02-01T00:00:00', 'zh', t);

    expect(t).toHaveBeenCalledWith('timeline.scale.quarter', { quarter: 4, year: 2026 });
    expect(t).toHaveBeenCalledWith('timeline.scale.quarter', { quarter: 1, year: 2027 });
    expect(headers).toEqual([
      'timeline.scale.quarter:{"quarter":4,"year":2026}',
      'timeline.scale.quarter:{"quarter":1,"year":2027}',
    ]);
  });

  it('the date scales do NOT go through the translate channel — they are `Intl`', () => {
    // The division of labour from objectui#4513: a locale TAG formats dates, a
    // translation spells vocabulary. A date scale asking `t()` would be this
    // card overreaching into the other one's territory.
    const t = vi.fn((key: string) => `TRANSLATED:${key}`);
    expect(generateTimeScaleHeaders('month', AUG_11, SEP_11, 'zh', t)).toEqual(['2026年8月', '2026年9月']);
    expect(generateTimeScaleHeaders('year', '2025-06-01', '2027-01-01', 'zh', t)).toEqual(['2025', '2026', '2027']);
    expect(t).not.toHaveBeenCalled();
  });
});

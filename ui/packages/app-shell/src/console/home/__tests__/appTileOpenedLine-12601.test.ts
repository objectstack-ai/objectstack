// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12601 — the line under a Home app tile ("2 hr. ago", zh
 * "2小时前打开") fits its tile in every pack, so it is never cut with an
 * ellipsis.
 *
 * Measured live at 1280 px, en: the long form "Opened 6 seconds ago" read
 * "Opened 6 secon…" in the tile. The line is now drawn in
 * `TILE_OPENED_TIME_FORMAT` (Intl's `short` style, `numeric: 'always'`) through
 * each pack's `home.appOpened`, and this file holds every pack's line, for the
 * realistic range (seconds to a year), to a width budget.
 *
 * ## The budget, derived
 *
 * - The tile is `w-28` (112 px) with `px-2` (8 px each side), and the line is
 *   `w-full` inside it: 112 − 2 × 8 = 96 px of text, at `text-[11px]`.
 * - The test DOM has no layout, so a line's width is ESTIMATED from its
 *   characters, in em of the 11 px font: a Han / kana / Hangul / full-width
 *   character 1.0, a space 0.32, an Arabic letter 0.53, a combining mark 0, any
 *   other character (Latin, Cyrillic, digit, punctuation) 0.62.
 * - Those weights were calibrated against real rendering: Chromium, 11 px,
 *   Inter (the UI font `@object-ui/components` declares) and DejaVu Sans (the
 *   widest fallback in the container), over every pack's line for these cases.
 *   The estimate fell short of a measured width by at most 2.4 px, so 3 px are
 *   held in reserve: the budget is 96 − 3 = 93 px. (A one-time reading, taken
 *   on the pull request for this card; nothing here re-measures it.)
 *
 * Exact strings are pinned for en and zh only, at the four points the card
 * names; every pack is held to the budget. The strings come from the ICU data
 * of the Node that runs the suite, which a browser's ICU can word differently,
 * so the budget — not the spelling — is what the other eight packs answer to.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { builtInLocales } from '@object-ui/i18n/locales';
import { timeAgo } from '../../../utils/relativeTime';
import { TILE_OPENED_TIME_FORMAT } from '../appLastOpened';

const TILE_PX = 112;
const TILE_PADDING_PX = 8;
const FONT_PX = 11;
const RESERVE_PX = 3;
const BUDGET_PX = TILE_PX - 2 * TILE_PADDING_PX - RESERVE_PX;

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const MARK = /\p{M}/u;
const ARABIC = /\p{Script=Arabic}/u;

/** The estimated rendered width of `text` at 11 px — see the module doc. */
function widthPx(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (MARK.test(ch)) continue;
    em += WIDE.test(ch) ? 1 : ch === ' ' ? 0.32 : ARABIC.test(ch) ? 0.53 : 0.62;
  }
  return em * FONT_PX;
}

const NOW = new Date('2026-10-16T12:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Seconds to a year ago, both ends of every unit the formatter switches through. */
const CASES: Array<[string, number]> = [
  ['6 s', 6 * SECOND],
  ['45 s', 45 * SECOND],
  ['5 min', 5 * MINUTE],
  ['59 min', 59 * MINUTE],
  ['3 h', 3 * HOUR],
  ['23 h', 23 * HOUR],
  ['1 d', 1 * DAY],
  ['2 d', 2 * DAY],
  ['6 d', 6 * DAY],
  ['29 d', 29 * DAY],
  ['1 mo', 31 * DAY],
  ['11 mo', 330 * DAY],
  ['1 y', 365 * DAY],
  ['12 y', 12 * 365 * DAY],
];

/** The line a tile draws: the pack's template around the tile's relative time. */
function tileLine(template: string, language: string, ago: number): string {
  const iso = new Date(NOW.getTime() - ago).toISOString();
  return template.replace('{{time}}', timeAgo(iso, language, TILE_OPENED_TIME_FORMAT));
}

const PACKS = Object.entries(builtInLocales).map(([language, pack]) => ({
  language,
  template: (pack as unknown as { home: { appOpened: string } }).home.appOpened,
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('a Home tile’s last-opened line fits its tile (objectui#12601)', () => {
  it(`every pack's line, seconds to a year, is within ${BUDGET_PX} px at ${FONT_PX} px`, () => {
    expect(PACKS).toHaveLength(10);
    const over: string[] = [];
    for (const { language, template } of PACKS) {
      expect(template, language).toContain('{{time}}');
      for (const [label, ago] of CASES) {
        const line = tileLine(template, language, ago);
        if (widthPx(line) > BUDGET_PX) over.push(`${language} ${label}: "${line}" ≈ ${widthPx(line).toFixed(1)} px`);
      }
    }
    expect(over).toEqual([]);
  });

  it('en and zh read as the card asks, at 6 s, 5 min, 3 h and 2 d', () => {
    const en = PACKS.find((p) => p.language === 'en')!.template;
    const zh = PACKS.find((p) => p.language === 'zh')!.template;
    const points = [6 * SECOND, 5 * MINUTE, 3 * HOUR, 2 * DAY];
    expect(points.map((ago) => tileLine(en, 'en', ago))).toEqual([
      '6 sec. ago',
      '5 min. ago',
      '3 hr. ago',
      '2 days ago',
    ]);
    expect(points.map((ago) => tileLine(zh, 'zh', ago))).toEqual(['6秒前打开', '5分钟前打开', '3小时前打开', '2天前打开']);
  });

  it('CONTROL — the long form the tile used to draw is over the budget', () => {
    const iso = new Date(NOW.getTime() - 6 * SECOND).toISOString();
    const before = 'Opened {{time}}'.replace('{{time}}', timeAgo(iso, 'en'));
    expect(before).toBe('Opened 6 seconds ago');
    expect(widthPx(before)).toBeGreaterThan(BUDGET_PX);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8958 — ONE authored `dueLike`, one overdue affordance, across the
 * two neighbouring date cell renderers.
 *
 * ## The declared contract
 *
 * `DetailViewFieldSchema.dueLike` (`@object-ui/types`' zod views) says, in the
 * `describe` text an author reads: "Marks a date/datetime field as
 * due/deadline-semantic, gating the relative 'Overdue Nd' wording (vs. neutral
 * 'Nd ago' for start/end/created dates)". Both types. `DateTimeCellRenderer`
 * never read the key.
 *
 * ## What was measured, before anything was changed
 *
 * Clock pinned to `2026-09-09T12:00:00.000Z`, `TZ=UTC` (root vitest config),
 * `en-US`, value `2026-09-06T09:30:00.000Z` (3 days past, inside the ±7-day
 * relative window), through the two cell renderers:
 *
 *   date     `dueLike: true` -> "Overdue 3d"  `tabular-nums text-red-600`
 *   datetime `dueLike: true` -> "3 days ago"  `tabular-nums text-sm whitespace-nowrap`
 *   datetime  no key at all  -> "3 days ago"  `tabular-nums text-sm whitespace-nowrap`
 *
 * Rows 2 and 3 were BYTE-IDENTICAL: the authored key changed nothing. That is
 * the silent-drop signature — the runtime accepts the key, parses it, drops
 * it, and renders something that still looks like a legitimate relative date,
 * so a reader cannot tell an honoured `dueLike` from a dropped one by looking
 * at the cell. A green suite therefore proves nothing by itself, and every
 * case below asserts a rendered FACE.
 *
 * ## The oracle is AGREEMENT, not a string
 *
 * The finding is the DISAGREEMENT between the two types, so the assertion is
 * `datetimeFace === dateFace` — anchored to the literal face as well, so a
 * redesign that moved both sides together cannot pass. A one-sided
 * reproduction could not distinguish "datetime drops it" from "nothing paints
 * overdue anywhere".
 *
 * ## Controls, and why each one is here
 *
 * - **A `datetime` WITHOUT `dueLike` renders exactly as before** — the
 *   population that must not move. Without it, "every datetime now says
 *   Overdue" passes every other case in this file.
 * - **A `dueLike` datetime that is NOT overdue** (future, and today) paints no
 *   affordance and stays byte-identical to the no-key face. Same reason.
 * - **The `date` cell, same run, same instant** — it already honoured the key,
 *   so it is what "honoured" looks like; without it an assertion here could be
 *   measuring a broken clock or a dead locale channel.
 *
 * ## The granularity is INHERITED, and is pinned as such
 *
 * `formatRelativeDate` compares calendar-day boundaries and gates its wording
 * on `diffDays < -1`, so **"Overdue 0d" is not a string this codebase can
 * produce** — the shortest overdue phrase is "Overdue 2d". Measured, because
 * it is the whole reason honouring the declaration is coherent at datetime
 * precision rather than nonsense: a datetime two hours past its deadline reads
 * "Today", exactly as the `date` cell has always answered for a deadline
 * falling today. Sub-day precision is a separate call and was not taken here.
 *
 * ## Directions
 *
 * Reverting the `dueLike` read in `DateTimeCellRenderer` turns the repro, the
 * styling cases, the heuristic case and the i18n case RED, and leaves every
 * control GREEN — the controls measure surfaces this change does not touch,
 * which is exactly why they can vouch for the run. Gating the red styling on
 * the relative branch alone turns the compact-face case RED. Making the cell
 * time-of-day aware turns the day-granularity cases RED.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateCellRenderer, DateTimeCellRenderer, formatRelativeDate } from '../index';

/** The pinned clock. `TZ=UTC` comes from the root vitest config. */
const CLOCK = '2026-09-09T12:00:00.000Z';

/** 3 days past — inside the ±7-day window, so the relative face is a PHRASE. */
const OVERDUE_3D = '2026-09-06T09:30:00.000Z';
/** 2.5 hours past, SAME calendar day — the sub-day case. */
const PAST_TODAY = '2026-09-09T09:30:00.000Z';
/** Yesterday late — one calendar day back: red, but not yet "Overdue Nd". */
const YESTERDAY_LATE = '2026-09-08T23:00:00.000Z';
/** Future, inside the window. */
const FUTURE_2D = '2026-09-11T09:30:00.000Z';
/** Beyond the window, where the relative face collapses onto the absolute one. */
const OUT_OF_WINDOW = '2026-08-31T09:30:00.000Z';

type Face = { text: string; cls: string; red: boolean };

/**
 * Same session harness as `datetimeCell.formatVocabulary-8853.test.tsx`: the
 * tag is the TENANT locale because that is the channel objectui#4468 made
 * every date branch read, and `persistLanguage={false}` keeps each case on its
 * own language instead of inheriting the previous one's.
 */
function renderSession(locale: string, language: string, node: React.ReactElement) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** Render one cell at the pinned clock; text and class, nothing retained. */
function faceOf(node: React.ReactElement, locale = 'en-US', language = 'en'): Face {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(CLOCK));
  try {
    const { container } = renderSession(locale, language, node);
    const cls = container.querySelector('span')?.getAttribute('class') ?? '';
    return { text: container.textContent ?? '', cls, red: cls.includes('text-red-600') };
  } finally {
    cleanup();
    vi.useRealTimers();
  }
}

const dateCell = (value: string, field: Record<string, unknown>) => (
  <DateCellRenderer value={value} field={{ type: 'date', ...field } as any} />
);

const dateTimeCell = (value: string, field: Record<string, unknown>) => (
  <DateTimeCellRenderer value={value} field={{ type: 'datetime', ...field } as any} />
);

/** The authored pair: one due-semantic field of each type, same relative face. */
const DUE_DATE = { name: 'due_on', dueLike: true, format: 'relative' };
const DUE_DATETIME = { name: 'due_at', dueLike: true, format: 'relative' };
/** The same datetime field with the key withheld — the control population. */
const PLAIN_DATETIME = { name: 'follow_up_at', format: 'relative' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('THE REPRO — one authored `dueLike`, one affordance, both cells (#8958)', () => {
  it('a datetime cell honours `dueLike`, and paints what its date sibling paints', () => {
    const date = faceOf(dateCell(OVERDUE_3D, DUE_DATE));
    const dateTime = faceOf(dateTimeCell(OVERDUE_3D, DUE_DATETIME));

    // The anchor, so a redesign that moved both sides together cannot pass.
    expect(date.text).toBe('Overdue 3d');
    expect(dateTime.text).toBe('Overdue 3d');

    // The claim itself: ONE authored key, ONE meaning, across the two cells —
    // in the wording AND in the styling, because the affordance is both.
    expect(dateTime.text).toBe(date.text);
    expect(dateTime.red).toBe(true);
    expect(date.red).toBe(true);
    expect(dateTime.red).toBe(date.red);

    // And what it used to be, named — not merely "something else".
    expect(dateTime.text).not.toBe('3 days ago');
  });

  it('the authored key is no longer byte-identical to withholding it', () => {
    const withKey = faceOf(dateTimeCell(OVERDUE_3D, DUE_DATETIME));
    const withoutKey = faceOf(dateTimeCell(OVERDUE_3D, PLAIN_DATETIME));

    // Before this change these two were identical in BOTH halves — that
    // identity IS the defect, so it is asserted away rather than merely
    // asserted around.
    expect(withKey.text).not.toBe(withoutKey.text);
    expect(withKey.cls).not.toBe(withoutKey.cls);
    expect(withoutKey.text).toBe('3 days ago');
  });
});

describe('CONTROLS — the populations that must NOT move', () => {
  it('a datetime WITHOUT `dueLike` renders exactly as it does today', () => {
    const face = faceOf(dateTimeCell(OVERDUE_3D, PLAIN_DATETIME));
    expect(face.text).toBe('3 days ago');
    // The full class list, verbatim: no red, and nothing else added either.
    expect(face.cls).toBe('tabular-nums text-sm whitespace-nowrap');
  });

  it('a `dueLike` datetime that is NOT overdue paints no affordance', () => {
    for (const value of [FUTURE_2D, PAST_TODAY]) {
      const withKey = faceOf(dateTimeCell(value, DUE_DATETIME));
      const withoutKey = faceOf(dateTimeCell(value, PLAIN_DATETIME));
      // Byte-identical here is CORRECT: the key is authored, the instant is
      // not overdue, so the affordance must stay away.
      expect(withKey.text).toBe(withoutKey.text);
      expect(withKey.cls).toBe(withoutKey.cls);
      expect(withKey.red).toBe(false);
    }
    expect(faceOf(dateTimeCell(FUTURE_2D, DUE_DATETIME)).text).toBe('In 2 days');
  });
});

describe('DAY GRANULARITY — inherited from the shared relative path, not re-decided', () => {
  it('"Overdue 0d" is not a string this codebase can produce', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CLOCK));
    try {
      // The wording gate is `diffDays < -1` on calendar-day boundaries, so
      // the sub-day and one-day cases never reach the overdue branch and the
      // SHORTEST overdue phrase is "Overdue 2d". This is the measurement that
      // makes honouring the declaration coherent at datetime precision.
      expect(formatRelativeDate(PAST_TODAY, { dueLike: true, locale: 'en-US' })).toBe('Today');
      expect(formatRelativeDate(YESTERDAY_LATE, { dueLike: true, locale: 'en-US' })).toBe('Yesterday');
      expect(formatRelativeDate('2026-09-07T09:30:00.000Z', { dueLike: true, locale: 'en-US' })).toBe('Overdue 2d');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a datetime hours past its deadline reads "Today", exactly as its date sibling does', () => {
    const dateTime = faceOf(dateTimeCell(PAST_TODAY, DUE_DATETIME));
    const date = faceOf(dateCell(PAST_TODAY, DUE_DATE));
    expect(dateTime.text).toBe('Today');
    expect(dateTime.text).toBe(date.text);
    expect(dateTime.red).toBe(false);
    expect(dateTime.red).toBe(date.red);
  });

  it('one calendar day back is red on both cells, and worded the same on both', () => {
    // The two halves have different thresholds — the wording needs
    // `diffDays < -1`, the styling only needs an earlier calendar day — and
    // that asymmetry is the `date` cell's own, inherited here rather than
    // re-decided, so the columns still agree with each other.
    const dateTime = faceOf(dateTimeCell(YESTERDAY_LATE, DUE_DATETIME));
    const date = faceOf(dateCell(YESTERDAY_LATE, DUE_DATE));
    expect(dateTime.text).toBe('Yesterday');
    expect(dateTime.text).toBe(date.text);
    expect(dateTime.red).toBe(true);
    expect(dateTime.red).toBe(date.red);
  });
});

describe('THE OTHER SURFACES the one key reaches', () => {
  it('CONTROL — with no key authored, a deadline-shaped name paints nothing on either cell', () => {
    // Inverted by objectui#11815 (ruling D). This pin used to assert the
    // field-name heuristic: `due_at` read "Overdue 3d" in red with nothing
    // authored. The heuristic is retired — overdue is declared-only — so the
    // same name now reads exactly as a neutral one, on both cells.
    const dateTime = faceOf(dateTimeCell(OVERDUE_3D, { name: 'due_at', format: 'relative' }));
    const date = faceOf(dateCell(OVERDUE_3D, { name: 'due_at', format: 'relative' }));
    expect(dateTime.text).toBe('3 days ago');
    expect(dateTime.text).toBe(date.text);
    expect(dateTime.red).toBe(false);
    expect(date.red).toBe(false);

    // A neutral name on the same instant reads the same.
    const neutral = faceOf(dateTimeCell(OVERDUE_3D, { name: 'created_at', format: 'relative' }));
    expect(neutral.text).toBe('3 days ago');
    expect(neutral.red).toBe(false);
  });

  it('the red styling is style-INDEPENDENT, on the compact face both cells default to', () => {
    // `'compact'` is this cell's DEFAULT face, so gating red on the relative
    // branch alone would leave the default population unchanged — the defect
    // narrowed rather than closed. The two faces differ in text (a datetime
    // keeps its time of day), so the agreement asserted here is the
    // affordance, which is what the authored key gates.
    const dateTime = faceOf(dateTimeCell(OVERDUE_3D, { name: 'due_at', dueLike: true }));
    const date = faceOf(dateCell(OVERDUE_3D, { name: 'due_on', dueLike: true, format: 'compact' }));
    expect(dateTime.red).toBe(true);
    expect(dateTime.red).toBe(date.red);
    // Still the compact face, not the relative one — reading the key must not
    // drag a different face along with it.
    expect(dateTime.text).not.toBe('Overdue 3d');

    const control = faceOf(dateTimeCell(OVERDUE_3D, { name: 'follow_up_at' }));
    expect(control.red).toBe(false);
    expect(control.text).toBe(dateTime.text);
  });

  it('beyond the ±7-day window both cells fall back to the absolute face, still red', () => {
    const dateTime = faceOf(dateTimeCell(OUT_OF_WINDOW, DUE_DATETIME));
    const date = faceOf(dateCell(OUT_OF_WINDOW, DUE_DATE));
    expect(dateTime.text).toBe('Aug 31');
    expect(dateTime.text).toBe(date.text);
    expect(dateTime.red).toBe(true);
    expect(dateTime.red).toBe(date.red);
  });

  it('the overdue phrase resolves through `t` on the datetime cell too', () => {
    // `formatRelativeDate` reaches `t` only through `dueLike`, which is why
    // objectui#8853 left it off this branch. It travels with the key now, so
    // a zh session does not read `Overdue 3d` beside a translated date cell.
    const dateTime = faceOf(dateTimeCell(OVERDUE_3D, DUE_DATETIME), 'zh', 'zh');
    const date = faceOf(dateCell(OVERDUE_3D, DUE_DATE), 'zh', 'zh');
    expect(dateTime.text).toBe('逾期 3 天');
    expect(dateTime.text).toBe(date.text);
  });
});

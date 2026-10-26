/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11676 — a date in the past is not "Overdue" by itself.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * With no `groupByField`, `ObjectTimeline` groups entries into date buckets,
 * and the bucket for any day before today was `timeline.bucket.overdue`,
 * whatever the bucketed field meant. The showcase's Activity Timeline binds
 * `startDateField: 'created_at'` and drew all ten tasks under "Overdue", the
 * two `Done` ones included. A creation date cannot be overdue, and neither can
 * a record that is closed.
 *
 * ── What the repair reads, and what it does not ─────────────────────────────
 * "Overdue" is a judgement that needs two facts: that the bucketed field is a
 * due date, and that the record is still open. Neither is declared anywhere
 * this timeline reads. The spec's `TimelineConfigSchema` carries
 * `startDateField`, `endDateField`, `titleField`, `groupByField`, `colorField`
 * and `scale`, and nothing that names a due-date role or a closed state; the
 * spec's field options declare no closed marker either. So a past day gets
 * the neutral `timeline.bucket.earlier` ("Earlier"), and no field NAME and no
 * status VALUE is read as one of those two facts.
 *
 * ── The key retires (triage ruling A on the card) ──────────────────────────
 * No timeline says "Overdue": that judgement stays where record state lives
 * (the date cell's due treatment, the gantt's alert colour, conditional
 * formatting). So `timeline.bucket.overdue`, which nothing read once the past
 * bucket became "Earlier", is gone from `TIMELINE_DEFAULT_TRANSLATIONS` and
 * from all ten packs; the last `describe` pins both. A due-date timeline, if a
 * producer ever asks for one, is a new card that declares its signals in the
 * spec first, not a row restored here.
 *
 * The clock is frozen on Tuesday 2026-10-06, and every value is a date-only
 * string, which the shared `toDisplayDate` step reads as local midnight of the
 * day it names (objectui#10866), so the buckets do not move with the runner's
 * zone. Every case mounts an `I18nProvider`: a provider-less case after the
 * `zh` one would resolve react-i18next's global language (objectui#4514).
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { BUILT_IN_LANGUAGE_CODES, builtInLocales } from '@object-ui/i18n/locales';
import { ObjectTimeline } from '../ObjectTimeline';
import { TIMELINE_DEFAULT_TRANSLATIONS, translateTimelineDefault } from '../useTimelineTranslation';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

/** Noon on Tuesday 2026-10-06, local time. */
const CLOCK = new Date(2026, 9, 6, 12, 0, 0);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Row = Record<string, unknown> & { id: string; title: string };

/**
 * Mount the timeline over `rows` with `startDateField: field`, in a `language`
 * session, and read back each bucket as `Bucket: title, title` in render order.
 */
function feed(rows: Row[], field: string, language = 'en'): string[] {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(CLOCK);
  // `data` is an undeclared passthrough prop on ObjectTimelineProps (the
  // component reads it off the rest args, which is how ListView feeds it).
  const props = {
    schema: {
      type: 'object-timeline',
      objectName: 'showcase_task',
      timeline: { startDateField: field, titleField: 'title' },
    },
    data: rows,
  } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <ObjectTimeline {...props} />
      </LocalizationProvider>
    </I18nProvider>,
  );
  screen.getByText(rows[0].title);
  return Array.from(document.querySelectorAll('section')).map((section) => {
    const bucket = section.querySelector('header > span:first-child')?.textContent ?? '';
    const titles = Array.from(section.querySelectorAll('h3')).map((h3) => h3.textContent);
    return `${bucket}: ${titles.join(', ')}`;
  });
}

/** The showcase's shape: a creation-date axis over open and Done tasks. */
const CREATED: Row[] = [
  { id: '1', title: 'Write brief', created_at: '2026-09-20', status: 'done' },
  { id: '2', title: 'Book venue', created_at: '2026-10-01', status: 'in_progress' },
  { id: '3', title: 'Send invites', created_at: '2026-10-05', status: 'done' },
  { id: '4', title: 'Order catering', created_at: '2026-10-06', status: 'todo' },
];

describe('ObjectTimeline past-date bucket (objectui#11676)', () => {
  it('a created_at timeline puts every past day under "Earlier" and shows no "Overdue", Done records included', () => {
    expect(feed(CREATED, 'created_at')).toEqual([
      'Earlier: Write brief, Book venue, Send invites',
      'Today: Order catering',
    ]);
    expect(document.body.textContent).not.toContain('Overdue');
  });

  it('CONTROL: today and every future bucket are unchanged, so only the past bucket moved', () => {
    const rows: Row[] = [
      { id: '1', title: 'Yesterday', when: '2026-10-05' },
      { id: '2', title: 'Now', when: '2026-10-06' },
      { id: '3', title: 'Next day', when: '2026-10-07' },
      { id: '4', title: 'Friday', when: '2026-10-09' },
      { id: '5', title: 'Next Tuesday', when: '2026-10-13' },
      { id: '6', title: 'Next month', when: '2026-11-20' },
      { id: '7', title: 'Undated', when: null },
    ];
    expect(feed(rows, 'when')).toEqual([
      'Earlier: Yesterday',
      'Today: Now',
      'Tomorrow: Next day',
      'This week: Friday',
      'Next week: Next Tuesday',
      'Later: Next month',
      'No date: Undated',
    ]);
  });

  it('no field name is read as a due-date role: a past `due_date` on an open record is "Earlier" too', () => {
    // The card's rule: field names are not guessed. Nothing the timeline reads
    // DECLARES this field a due date or this status open, so the neutral bucket
    // is the honest answer. A name heuristic would flip this case to "Overdue".
    const rows: Row[] = [
      { id: '1', title: 'Renew lease', due_date: '2026-10-02', status: 'open' },
      { id: '2', title: 'File taxes', due_date: '2026-10-08', status: 'open' },
    ];
    expect(feed(rows, 'due_date')).toEqual(['Earlier: Renew lease', 'This week: File taxes']);
    expect(document.body.textContent).not.toContain('Overdue');
  });

  it('the past bucket label is the translated pack key, not English: a zh session reads 更早', () => {
    expect(feed(CREATED, 'created_at', 'zh')).toEqual([
      '更早: Write brief, Book venue, Send invites',
      '今天: Order catering',
    ]);
    expect(document.body.textContent).not.toContain('已逾期');
  });
});

/** The retired key, fully qualified, and its leaf inside each pack's `timeline.bucket`. */
const RETIRED_KEY = 'timeline.bucket.overdue';
const RETIRED_LEAF = 'overdue';

type Pack = (typeof builtInLocales)[keyof typeof builtInLocales];
const PACKS = Object.entries(builtInLocales) as Array<[string, Pack]>;

describe('`timeline.bucket.overdue` is retired from the defaults row and every pack (objectui#11676)', () => {
  it('reads every built-in pack and a defaults table that still has its bucket rows', () => {
    // Non-vacuity: each assertion below reads these, so an unresolved import, a
    // pack dropped from `builtInLocales` or an emptied table would be green
    // without this.
    expect(PACKS.map(([lang]) => lang).sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
    expect(TIMELINE_DEFAULT_TRANSLATIONS['timeline.bucket.earlier']).toBe('Earlier');
    for (const [lang, pack] of PACKS) {
      expect(Object.keys(pack.timeline.bucket), lang).toContain('earlier');
    }
  });

  it('the defaults row is gone, and the provider-less fallback answers the bare key', () => {
    expect(Object.keys(TIMELINE_DEFAULT_TRANSLATIONS)).not.toContain(RETIRED_KEY);
    expect(translateTimelineDefault(RETIRED_KEY)).toBe(RETIRED_KEY);
  });

  it('no pack carries it, while the `fields.relativeDate.overdue` family beside it stays', () => {
    const carriers = PACKS.filter(([, pack]) => RETIRED_LEAF in pack.timeline.bucket).map(([lang]) => lang);
    expect(
      carriers,
      'A pack carries `timeline.bucket.overdue` again. No timeline reads it: a past day is ' +
        '"Earlier", and triage ruled that no timeline says "Overdue" (objectui#11676). A ' +
        'due-date timeline is a new card that declares its signals in the spec first.',
    ).toEqual([]);
    // A different family that happens to share the leaf name: the date cell's
    // "Overdue Nd" phrase. A sweep by leaf name rather than by key takes it out.
    for (const [lang, pack] of PACKS) {
      expect(typeof pack.fields.relativeDate.overdue, lang).toBe('string');
    }
  });
});

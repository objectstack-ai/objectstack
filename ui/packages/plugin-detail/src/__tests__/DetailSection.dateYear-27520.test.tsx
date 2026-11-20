/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A record page writes every date one way (objectstack#27520 row 14).
 *
 * The sighting was a project record whose highlights strip read
 * "End Date Dec 31, 2026" while a section below read "Start Date Oct 2": the
 * strip writes the year on every date (objectui#13331) and the section row
 * used the shared face that drops the current year. A section row now passes
 * the same `alwaysShowYear`, so both read with the year. A grid cell keeps the
 * face that drops it.
 *
 * The clock is pinned, so "the current year" is 2026 and every date is
 * outside the relative window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { DateFieldMetadata, DetailViewSection, HighlightField } from '@object-ui/types';
import { getCellRenderer } from '@object-ui/fields';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

const CLOCK = '2026-11-01T12:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const objectSchema = {
  fields: {
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
    kickoff_at: { name: 'kickoff_at', type: 'datetime', label: 'Kickoff', format: 'relative' },
  },
};

const data = { start_date: '2026-10-02', end_date: '2026-12-31', kickoff_at: '2026-09-29T12:00:00.000Z' };

const section = {
  title: 'Timeline',
  fields: [
    { name: 'start_date', label: 'Start Date', type: 'date' },
    { name: 'kickoff_at', label: 'Kickoff', type: 'datetime', format: 'relative' },
  ],
} as unknown as DetailViewSection;

describe('one date format on a record page (objectstack#27520 row 14)', () => {
  it('a section row writes the year on a current-year date', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(screen.getByText('Oct 2, 2026')).toBeTruthy();
    expect(screen.queryByText('Oct 2')).toBeNull();
    // A `relative` datetime past the relative window falls back to the same face.
    expect(screen.getByText('Sep 29, 2026')).toBeTruthy();
  });

  it('the section and the highlights strip draw a current-year date alike', () => {
    render(
      <>
        <HeaderHighlight
          fields={[{ name: 'end_date', label: 'End Date' }] satisfies HighlightField[]}
          data={data}
          objectSchema={objectSchema}
        />
        <DetailSection
          section={{ title: 'Timeline', fields: [{ name: 'end_date', label: 'End Date', type: 'date' }] } as unknown as DetailViewSection}
          data={data}
          objectSchema={objectSchema}
        />
      </>,
    );
    expect(screen.getAllByText('Dec 31, 2026')).toHaveLength(2);
  });

  it('CONTROL: a grid cell keeps the face that drops the current year', () => {
    const DateCell = getCellRenderer('date');
    const field: DateFieldMetadata = { name: 'start_date', label: 'Start Date', type: 'date' };
    render(<DateCell value="2026-10-02" field={field} />);
    expect(screen.getByText('Oct 2')).toBeTruthy();
  });
});

/**
 * A business date on a record page reads as the date (objectstack#35745).
 *
 * The sighting: a meeting's date, Nov 13, read "6 days ago" on the record page
 * while the list wrote "Nov 13", so the reader had to work out the day. The
 * page's date fields now take the absolute face the list's columns take
 * (objectstack#25884), inside the ±7-day window too, and the relative phrase
 * is the date's tooltip. A declared `format` still wins.
 */
describe('a record page writes a business date as the date (objectstack#35745)', () => {
  const days = {
    past: { iso: '2026-10-29', text: 'Oct 29, 2026', phrase: '3 days ago' },
    today: { iso: '2026-11-01', text: 'Nov 1, 2026', phrase: 'Today' },
    future: { iso: '2026-11-05', text: 'Nov 5, 2026', phrase: 'In 4 days' },
  };
  const meetingSchema = { fields: { meeting_date: { name: 'meeting_date', type: 'date', label: 'Meeting Date' } } };
  const meetingSection = {
    title: 'Meeting',
    fields: [{ name: 'meeting_date', label: 'Meeting Date', type: 'date' }],
  } as unknown as DetailViewSection;

  for (const [when, day] of Object.entries(days)) {
    it(`a section row writes a ${when} date in the relative window as the date, the phrase as its tooltip`, () => {
      render(<DetailSection section={meetingSection} data={{ meeting_date: day.iso }} objectSchema={meetingSchema} />);
      const cell = screen.getByText(day.text);
      expect(cell.getAttribute('title')).toBe(day.phrase);
      expect(screen.queryByText(day.phrase)).toBeNull();
    });
  }

  it('the highlights strip writes it the same way', () => {
    render(
      <HeaderHighlight
        fields={[{ name: 'meeting_date', label: 'Meeting Date' }] satisfies HighlightField[]}
        data={{ meeting_date: days.past.iso }}
        objectSchema={meetingSchema}
      />,
    );
    expect(screen.getByText(days.past.text).getAttribute('title')).toBe(days.past.phrase);
  });

  it('a declared `relative` format still wins', () => {
    const declared = { fields: { meeting_date: { ...meetingSchema.fields.meeting_date, format: 'relative' } } };
    render(<DetailSection section={meetingSection} data={{ meeting_date: days.past.iso }} objectSchema={declared} />);
    expect(screen.getByText(days.past.phrase)).toBeTruthy();
  });

  // #35745 names 日期时间 too. A `datetime` field with no declared `format`
  // already paints the compact absolute face everywhere (`DateTimeCellRenderer`
  // defaults to `'compact'`), so the record page needs no prop for it; this
  // pins that it reads as the date (the compact face, `10/29/2026`), never as
  // the relative phrase.
  it('a `datetime` field in the relative window reads as its date, in a section row and the highlights strip', () => {
    const at = '2026-10-29T12:00:00';
    const schema = { fields: { starts_at: { name: 'starts_at', type: 'datetime', label: 'Starts At' } } };
    const section = { title: 'Meeting', fields: [{ name: 'starts_at', label: 'Starts At', type: 'datetime' }] } as unknown as DetailViewSection;
    const { unmount } = render(<DetailSection section={section} data={{ starts_at: at }} objectSchema={schema} />);
    expect(screen.getByText('10/29/2026')).toBeTruthy();
    expect(screen.queryByText(/days? ago/)).toBeNull();
    unmount();
    render(
      <HeaderHighlight
        fields={[{ name: 'starts_at', label: 'Starts At' }] satisfies HighlightField[]}
        data={{ starts_at: at }}
        objectSchema={schema}
      />,
    );
    expect(screen.getByText('10/29/2026')).toBeTruthy();
    expect(screen.queryByText(/days? ago/)).toBeNull();
  });

  it('CONTROL: the shared date cell without the record page keeps the relative default', () => {
    const DateCell = getCellRenderer('date');
    const field: DateFieldMetadata = { name: 'meeting_date', label: 'Meeting Date', type: 'date' };
    render(<DateCell value={days.past.iso} field={field} />);
    expect(screen.getByText(days.past.phrase)).toBeTruthy();
  });
});

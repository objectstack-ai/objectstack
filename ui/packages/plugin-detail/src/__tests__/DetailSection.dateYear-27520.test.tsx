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

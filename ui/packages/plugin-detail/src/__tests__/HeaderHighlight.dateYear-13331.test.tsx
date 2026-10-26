/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record header's highlights write the year on every date
 * (objectui#13331).
 *
 * The sighting was a contract record whose strip read
 * "Start Date Sep 15, 2025 | End Date Sep 15": the shared date face drops the
 * current year, so a contract that ended this September read as ending next
 * month. The strip now passes `alwaysShowYear` to its cell renderer, so one
 * record's two dates read alike. A grid cell, which renders the same `date`
 * cell without that prop, keeps the face that drops the current year.
 *
 * The clock is pinned to the card's day, so "the current year" is 2026 and
 * both dates are outside the ±7-day relative window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as React from 'react';
import type { DateFieldMetadata, HighlightField } from '@object-ui/types';
import { getCellRenderer } from '@object-ui/fields';
import { HeaderHighlight } from '../HeaderHighlight';

const CLOCK = '2026-10-23T12:00:00.000Z';

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
    start_date: { type: 'date', label: 'Start Date' },
    end_date: { type: 'date', label: 'End Date' },
    signed_at: { type: 'datetime', label: 'Signed At', format: 'relative' },
  },
};

/** The chip whose label is `label`, as the strip draws it. */
function chip(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe('HeaderHighlight date year (objectui#13331)', () => {
  it('writes the year on a current-year date beside a past-year date', () => {
    render(
      <HeaderHighlight
        fields={
          [
            { name: 'start_date', label: 'Start Date' },
            { name: 'end_date', label: 'End Date' },
            { name: 'signed_at', label: 'Signed At' },
          ] satisfies HighlightField[]
        }
        data={{ start_date: '2025-09-15', end_date: '2026-09-15', signed_at: '2026-09-15T12:00:00.000Z' }}
        objectSchema={objectSchema}
      />,
    );

    expect(within(chip('Start Date')).getByText('Sep 15, 2025')).toBeTruthy();
    expect(within(chip('End Date')).getByText('Sep 15, 2026')).toBeTruthy();
    // A `datetime` declared `relative` falls back to the same date face.
    expect(within(chip('Signed At')).getByText('Sep 15, 2026')).toBeTruthy();
  });

  it('leaves the grid cell face, which drops the current year, as it was', () => {
    const DateCell = getCellRenderer('date');
    const field: DateFieldMetadata = { name: 'end_date', label: 'End Date', type: 'date' };
    render(<DateCell value="2026-09-15" field={field} />);
    expect(screen.getByText('Sep 15')).toBeTruthy();
  });
});

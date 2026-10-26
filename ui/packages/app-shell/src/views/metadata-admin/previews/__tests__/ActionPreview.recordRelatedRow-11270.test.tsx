// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11270 — the action designer previews `record_related` where the
 * console places it: on each row of a related list inside a record, drawn with
 * the row frame `list_item` already has. Not a button in a section header.
 *
 * The header drawing was the toolbar reading that objectstack-ai/objectstack#20937's
 * enforce answer (triage `5919625056`) replaced with row placement; with the
 * console placing it per row, a header preview would show the author a
 * placement the product does not use (the ADR-0078 shape; cross-lane scope note
 * `5920436535` on the card).
 *
 * Paired like `ActionPreview.locations.test.tsx`: each absence is read over the
 * same render as a presence, so a vacuous pass needs both halves to fail.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';

import { ActionPreview } from '../ActionPreview';

afterEach(cleanup);

function renderWithLocations(locations: string[]) {
  return render(
    <ActionPreview
      type="action"
      name="log_time"
      draft={{
        name: 'log_time',
        label: 'Log Time',
        type: 'form',
        target: 'task.edit',
        locations,
      }}
    />,
  );
}

/** The "Where it appears" section (see `ActionPreview.locations.test.tsx` for why it is scoped). */
function placement() {
  const heading = screen.getByText('Where it appears');
  return within(heading.parentElement!.parentElement!);
}

/** One frame's body, found by its location caption. */
function frame(location: string) {
  const caption = placement().getByText(location);
  return within(caption.parentElement!);
}

describe('ActionPreview — `record_related` previews on each related-list row (objectui#11270)', () => {
  it('draws the row frame: the action on each row, and no section header', () => {
    renderWithLocations(['record_related']);
    const body = frame('record_related');
    expect(body.getByText('Row 1')).toBeTruthy();
    expect(body.getByText('Row 2')).toBeTruthy();
    expect(body.getAllByText('Log Time')).toHaveLength(2);
    // The replaced reading: a section header carrying one button.
    expect(body.queryByText('Section')).toBeNull();
    expect(placement().queryByText('record_section')).toBeNull();
  });

  it('CONTROL: `record_section` keeps its section-header frame', () => {
    renderWithLocations(['record_section']);
    const section = frame('record_section');
    expect(section.getByText('Section')).toBeTruthy();
    expect(section.getAllByText('Log Time')).toHaveLength(1);
    expect(placement().queryByText('record_related')).toBeNull();
  });

  it('`record_section` and `record_related` each draw their own frame — header and rows', () => {
    renderWithLocations(['record_section', 'record_related']);
    const section = frame('record_section');
    expect(section.getByText('Section')).toBeTruthy();
    expect(section.getAllByText('Log Time')).toHaveLength(1);
    const rows = frame('record_related');
    expect(rows.getAllByText('Log Time')).toHaveLength(2);
    expect(rows.queryByText('Section')).toBeNull();
  });

  it('`list_item` and `record_related` draw the same row frame, each under its own caption', () => {
    renderWithLocations(['list_item', 'record_related']);
    expect(frame('list_item').getAllByText('Log Time')).toHaveLength(2);
    expect(frame('record_related').getAllByText('Log Time')).toHaveLength(2);
  });
});

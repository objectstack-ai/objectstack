/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A hand-written record page's key-field strip is a two-column grid on a
 * phone, as the default page's is (objectstack#34595).
 *
 * Measured on a hand-written opportunity page at 375 px: the strip drew its
 * six key fields one per line, each with its own pencil, so the fields alone
 * filled the first screen. The default page's strip is a grid of at least two
 * columns there. Below `sm` the hand-written strip now takes the same grid:
 * two equal columns, so six fields read as three rows. From `sm` up it is the
 * wrapping row it always was.
 *
 * The test DOM resolves no Tailwind and has no layout engine, so this file
 * pins the class shape only; it measures no width.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import type { HighlightField } from '@object-ui/types';
import { HeaderHighlight } from '../HeaderHighlight';
import { DefaultRecordPageContext } from '../defaultRecordPage';

/** The opportunity's six key fields, with their own field shapes. */
const opportunitySchema = {
  fields: {
    amount: { type: 'currency', label: 'Amount' },
    expected_revenue: { type: 'currency', label: 'Expected Revenue' },
    close_date: { type: 'date', label: 'Close Date' },
    probability: { type: 'percent', label: 'Probability' },
    account_id: { type: 'lookup', label: 'Account', reference: 'account' },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  },
};

const opportunityData = {
  amount: 94000,
  expected_revenue: 75200,
  close_date: '2026-11-24',
  probability: 80,
  account_id: { id: 'a1', name: 'Vertex Analytics' },
  owner_id: { id: 'u1', name: 'Jianguo Zhuang' },
};

const opportunityFields: HighlightField[] = Object.entries(opportunitySchema.fields).map(([name, f]) => ({
  name,
  label: f.label,
}));

const mount = (defaultPage = false) =>
  render(
    <DefaultRecordPageContext.Provider value={defaultPage}>
      <HeaderHighlight
        fields={opportunityFields}
        data={opportunityData}
        objectSchema={opportunitySchema}
        objectName="opportunity"
      />
    </DefaultRecordPageContext.Provider>,
  );

const rowOf = (container: HTMLElement) => container.querySelector('section > div') as HTMLElement;
const chipsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('section > div > div.group')) as HTMLElement[];
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

describe('a hand-written page\'s key-field strip is a two-column grid on a phone (objectstack#34595)', () => {
  it('lays the row out as the default page\'s two-column grid below `sm`', () => {
    const { container } = mount();
    const row = rowOf(container);
    expect(row).not.toHaveAttribute('data-highlights-face');
    expect(tokens(row)).toEqual(
      expect.arrayContaining(['max-sm:grid', 'max-sm:grid-cols-2', 'max-sm:gap-x-4', 'max-sm:gap-y-3']),
    );
  });

  it('gives each of the six fields one cell, wide types included, so they read as three rows', () => {
    const { container } = mount();
    const chips = chipsOf(container);
    expect(chips).toHaveLength(6);
    for (const chip of chips) {
      const t = tokens(chip);
      // A cell, not a line: nothing asks for the full row or a second column.
      expect(t).not.toContain('max-sm:basis-full');
      expect(t.some((c) => c.startsWith('max-sm:col-span'))).toBe(false);
      expect(t).toEqual(expect.arrayContaining(['max-sm:min-w-0', 'max-sm:max-w-full']));
      // No separator inside the grid.
      expect(t).toEqual(expect.arrayContaining(['max-sm:border-l-0', 'max-sm:px-0']));
    }
  });

  it('CONTROL: from `sm` up the row still wraps with its separators and floors', () => {
    const { container } = mount();
    const row = rowOf(container);
    expect(tokens(row)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'sm:-ml-[calc(var(--spacing)*5+1px)]']));
    expect(tokens(row).some((c) => c === 'grid' || c.startsWith('grid-cols'))).toBe(false);
    for (const chip of chipsOf(container)) {
      expect(tokens(chip)).toEqual(expect.arrayContaining(['border-l', 'px-5', 'grow', 'max-w-max']));
    }
  });

  it('CONTROL: the default page\'s grid face is untouched', () => {
    const { container } = mount(true);
    const row = rowOf(container);
    expect(row).toHaveAttribute('data-highlights-face', 'grid');
    expect(tokens(row)).toEqual(expect.arrayContaining(['grid', 'grid-cols-2']));
    expect(tokens(row).some((c) => c.startsWith('max-sm:'))).toBe(false);
  });
});

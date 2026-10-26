/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13229 — typing an option's visible LABEL must find it.
 *
 * cmdk scores an item on its `value` and its `keywords`, never on the item's
 * children. The combobox gave each `CommandItem` the option's value and put
 * the label in the children only, so a label that is not inside the value
 * matched nothing: "Opportunities" for `crm_opp`, a user's name for a record
 * id, a Chinese label. The fix passes the label as a cmdk keyword.
 *
 * Every test that searches by a label goes red with the keyword removed. The
 * CONTROLS keep them honest: the value still matches, a pick reached through
 * the label still commits the value (never the label), and a query that
 * matches neither still reaches the empty state. The non-string test goes red
 * with the keyword passed unguarded.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Combobox } from '../custom/combobox';

// The shapes the measured consumers build: `Label (name)` for objects, a
// person's name over a record id, a Chinese label over an API name.
const OPTIONS = [
  { value: 'crm_opp', label: 'Opportunities (crm_opp)' },
  { value: 'crm_account', label: 'Accounts (crm_account)' },
  { value: 'showcase_project_membership', label: '成员 (showcase_project_membership)' },
  { value: 'usr_01HZX9', label: 'Alice Zhang' },
];

function openAndType(query: string) {
  fireEvent.click(screen.getByRole('combobox'));
  const search = screen.getByPlaceholderText('Search...');
  fireEvent.change(search, { target: { value: query } });
  return search;
}

function shownOptionNames(): string[] {
  return screen.queryAllByRole('option').map((o) => o.textContent ?? '');
}

describe('Combobox searches option labels, not only values (objectui#13229)', () => {
  it('typing a plural display label finds the option whose value does not contain it', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openAndType('Opportunities');

    expect(shownOptionNames()).toEqual(['Opportunities (crm_opp)']);
  });

  it('typing a non-Latin label finds the option', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openAndType('成员');

    expect(shownOptionNames()).toEqual(['成员 (showcase_project_membership)']);
  });

  it("typing a person's name finds the option whose value is a record id", () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openAndType('Alice Zhang');

    expect(shownOptionNames()).toEqual(['Alice Zhang']);
  });

  it('CONTROL — typing a value fragment still finds the option', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openAndType('crm_opp');

    // cmdk's match is a fuzzy subsequence over the value and the keywords
    // together, so a looser match may list below it; the option itself is
    // found and ranked first.
    expect(shownOptionNames()[0]).toBe('Opportunities (crm_opp)');
  });

  it('CONTROL — clicking an option found by its label commits its value', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    openAndType('Alice');

    fireEvent.click(screen.getByRole('option', { name: /Alice Zhang/ }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('usr_01HZX9');
  });

  it('CONTROL — Enter on a search narrowed by label commits the value', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    const search = openAndType('成员');

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('showcase_project_membership');
  });

  it('an option whose label arrives as a non-string still renders and is found by its value, as before', () => {
    // Out of contract on purpose: `label` is declared `string`, but the
    // `combobox` schema node passes JSON options through unvalidated. cmdk
    // trims every keyword, so handing it this label would throw and take the
    // picker down; before the keyword existed these options rendered. The cast
    // is the point of the test, not a pattern to copy.
    const outOfContract = [
      { value: 'numeric_label', label: 5 },
      { value: 'missing_label' },
    ] as unknown as React.ComponentProps<typeof Combobox>['options'];
    render(<Combobox options={outOfContract} value="" onValueChange={vi.fn()} />);
    openAndType('numeric');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveAttribute('data-value', 'numeric_label');
  });

  it('CONTROL — a query matching neither a label nor a value shows the empty state', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openAndType('zzqx');

    expect(shownOptionNames()).toEqual([]);
    expect(screen.getByText('No option found.')).toBeInTheDocument();
  });
});

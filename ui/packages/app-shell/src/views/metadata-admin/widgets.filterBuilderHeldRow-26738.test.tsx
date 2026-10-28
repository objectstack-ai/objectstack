// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26738 — the `filter-builder` widget HOLDS a condition row until
 * it is complete, so "Add filter" adds a row that can be edited.
 *
 * The widget used to re-derive the builder's rows from the stored rules on
 * every render. The fold (`foldFilterGroupToSpecRules`) drops a row that is
 * not complete yet — the blank row "Add filter" inserts — and must keep
 * dropping it, so the next render of the host erased the new row: the Studio
 * list-view inspector could not author a filter at all.
 *
 * Pinned here, through a host that writes the way the list-view inspector
 * does (a NEW body object on every `onChange`, so every write re-renders):
 *
 *  - "Add filter" adds a row that stays on screen, and writes nothing while
 *    the row is incomplete;
 *  - completing the row writes exactly the complete rule, and the row stays;
 *  - a stored filter shows as its rows and round-trips unchanged: opening it
 *    writes nothing, and its rule reaches the host as stored;
 *  - CONTROL: a stored filter that changes from outside re-seeds the rows.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WIDGETS } from './widgets';
import { loaded } from './loadState';

// The builder lives inside a Radix popover, which does not open in jsdom.
// Rendering the popover parts inline is this directory's existing way of
// reaching it (`WidgetContext.catalogUnion.test.tsx`); the rest of the barrel
// stays real. No JSX in the factory: `vi.mock` is hoisted above the imports.
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

afterEach(cleanup);

const FIELDS = loaded([
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'status', label: 'Status', type: 'text' },
]);

type Rule = { field: string; operator: string; value?: unknown };
type Body = { type: string; filter?: Rule[] };

const FilterWidget = WIDGETS['filter-builder'];

/**
 * Writes like `ObjectListViewInspector`'s Filter row: drop `filter` when the
 * rules are empty, and store a NEW body either way.
 */
function Host({ initial, writes }: { initial: Body; writes: Array<Rule[] | undefined> }) {
  const [body, setBody] = React.useState<Body>(initial);
  return (
    <>
      <FilterWidget
        schema={{}}
        value={body.filter}
        context={{ conditionScope: 'none', objectFields: FIELDS }}
        onChange={(rules) => {
          writes.push(rules as Rule[] | undefined);
          const { filter: _dropped, ...rest } = body;
          setBody(Array.isArray(rules) && rules.length > 0 ? { ...rest, filter: rules as Rule[] } : { ...rest });
        }}
      />
      <pre data-testid="stored-body">{JSON.stringify(body)}</pre>
      <button type="button" data-testid="external-edit" onClick={() =>
        setBody({ ...body, filter: [{ field: 'status', operator: 'equals', value: 'closed' }] })
      } />
    </>
  );
}

const storedBody = (): Body => JSON.parse(screen.getByTestId('stored-body').textContent ?? 'null');
const valueInputs = () => screen.queryAllByPlaceholderText('Value') as HTMLInputElement[];

describe('the filter-builder widget holds a row until it is complete (objectstack#26738)', () => {
  it('"Add filter" adds an editable row, writes nothing until it is complete, then writes the complete rule', () => {
    const writes: Array<Rule[] | undefined> = [];
    render(<Host initial={{ type: 'grid' }} writes={writes} />);
    expect(valueInputs()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    // The blank row is on screen, and the view is untouched.
    expect(valueInputs()).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(storedBody()).toEqual({ type: 'grid' });

    fireEvent.change(valueInputs()[0], { target: { value: 'open' } });

    // Complete: exactly the rule is written, and the row stays with its value.
    expect(writes).toEqual([[{ field: 'title', operator: 'equals', value: 'open' }]]);
    expect(storedBody()).toEqual({ type: 'grid', filter: [{ field: 'title', operator: 'equals', value: 'open' }] });
    expect(valueInputs()).toHaveLength(1);
    expect(valueInputs()[0].value).toBe('open');
    expect(screen.getByTestId('filter-builder-trigger')).toHaveTextContent('Title');
  });

  it('holds a second, incomplete row beside a stored rule without writing it', () => {
    const writes: Array<Rule[] | undefined> = [];
    const stored = [{ field: 'status', operator: 'equals', value: 'open' }];
    render(<Host initial={{ type: 'grid', filter: stored }} writes={writes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(valueInputs()).toHaveLength(2);
    expect(writes).toEqual([]);
    expect(storedBody().filter).toEqual(stored);
  });

  it('shows a stored filter as its rows and round-trips it unchanged', () => {
    const writes: Array<Rule[] | undefined> = [];
    const stored = [{ field: 'status', operator: 'equals', value: 'open' }];
    render(<Host initial={{ type: 'grid', filter: stored }} writes={writes} />);

    // Opening it is a read: one row, its value, its field in the summary — no write.
    expect(valueInputs()).toHaveLength(1);
    expect(valueInputs()[0].value).toBe('open');
    expect(screen.getByTestId('filter-builder-trigger')).toHaveTextContent('Status');
    expect(writes).toEqual([]);

    // An edit writes the rule in the stored shape, and the next edit back
    // restores exactly what was stored.
    fireEvent.change(valueInputs()[0], { target: { value: 'opened' } });
    fireEvent.change(valueInputs()[0], { target: { value: 'open' } });
    expect(writes.at(-1)).toEqual(stored);
    expect(storedBody().filter).toEqual(stored);
  });

  it('CONTROL: a stored filter that changes from outside re-seeds the rows', () => {
    const writes: Array<Rule[] | undefined> = [];
    render(<Host initial={{ type: 'grid', filter: [{ field: 'status', operator: 'equals', value: 'open' }] }} writes={writes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(valueInputs()).toHaveLength(2);

    fireEvent.click(screen.getByTestId('external-edit'));

    // The held blank row belonged to the old filter; the new one is shown as stored.
    expect(valueInputs()).toHaveLength(1);
    expect(valueInputs()[0].value).toBe('closed');
    expect(writes).toEqual([]);
  });
});

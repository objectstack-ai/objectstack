/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lookup quick-picker takes the choice, and the trigger shows it —
 * objectui#13162.
 *
 * Two halves, both measured in a browser on the published console before this
 * card (the Delegations create form and the Set Manager action dialog):
 *
 *  (a) After a search, Enter set nothing. No row was active until an arrow key
 *      moved to one, and an arrow key pressed before the debounced answer
 *      landed was undone when the answer replaced the list. A click on a row
 *      always committed it; a click aimed at the rows shown before the answer
 *      landed could reach no row at all, which no widget-side rule can repair
 *      (the PR body records that reading).
 *  (b) A full-size single-select field drew its value as a chip ABOVE a
 *      trigger that went on reading "Select…", so a field holding a value read
 *      as one still asking for it.
 *
 * Pinned: Enter takes the first match once the rows answer the typed term,
 * an early arrow key does not void it, Enter while the answer is pending takes
 * nothing (never a row the typed term did not ask for), and the trigger draws
 * the picked, searched-and-picked and hydrated record. Controls: a click after
 * a search, clearing, a disabled field, "Browse all records", and multi-select.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LookupField } from './LookupField';

const ROWS: Record<string, unknown>[] = [
  { id: 'u1', name: 'Dev Admin' },
  { id: 'u2', name: 'Marta Quinn' },
  { id: 'u3', name: 'Priya Raman' },
];

/**
 * A backend that answers `$search` by the name, and can HOLD a search answer
 * until the test releases it, so the test decides whether a key lands before
 * or after the answer.
 */
function makeBackend(opts: { holdSearch?: boolean } = {}) {
  let releaseSearch: (() => void) | null = null;
  const find = vi.fn(async (_objectName: string, params?: { $search?: string; $filter?: { id?: { $in?: unknown[] } } }) => {
    const wanted: unknown[] | undefined = params?.$filter?.id?.$in;
    if (wanted) {
      const rows = ROWS.filter((r) => wanted.includes(r.id));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }
    const term: string | undefined = params?.$search;
    if (!term) return { data: ROWS.map((r) => ({ ...r })), total: ROWS.length };
    const rows = ROWS.filter((r) => String(r.name).toLowerCase().includes(term.toLowerCase()));
    const answer = { data: rows.map((r) => ({ ...r })), total: rows.length };
    if (!opts.holdSearch) return answer;
    await new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    return answer;
  });
  const findOne = vi.fn(async (_objectName: string, id: string) => {
    const row = ROWS.find((r) => r.id === id);
    return row ? { ...row } : null;
  });
  return {
    ds: { find, findOne },
    release: async () => {
      await act(async () => {
        releaseSearch?.();
      });
      await settle();
    },
    searchCalls: () => find.mock.calls.filter((c) => c[1]?.$search),
  };
}

type Ds = ReturnType<typeof makeBackend>['ds'];

/** Holds the value, as a form or the action param dialog does. */
function Host({ ds, initial = null, field, disabled }: { ds?: Ds; initial?: unknown; field?: Record<string, unknown>; disabled?: boolean }) {
  const [value, setValue] = React.useState<unknown>(initial);
  return (
    <>
      <LookupField
        value={value}
        onChange={(v: unknown) => setValue(v)}
        dataSource={ds as never}
        disabled={disabled}
        field={{ name: 'managerId', reference: 'sys_user', label: 'Manager', ...field } as never}
      />
      <output data-testid="host-value">{JSON.stringify(value)}</output>
    </>
  );
}

async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

const hostValue = () => JSON.parse(screen.getByTestId('host-value').textContent || 'null');
const trigger = () => screen.getByTestId('lookup-trigger-managerId');
const optionTitles = () => screen.queryAllByRole('option').map((o) => o.getAttribute('title'));

async function openDropdown(): Promise<void> {
  await act(async () => {
    fireEvent.click(trigger());
  });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBe(ROWS.length));
  await settle();
}

/** Type a term; the kernel's 300ms debounce has not fired when this returns. */
async function typeSearch(term: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: term } });
  });
}

/** Wait out the debounce, so the search query is issued (and, unheld, answered). */
async function waitOutDebounce(): Promise<void> {
  await settle(70);
}

async function press(key: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('combobox'), { key });
  });
  await settle();
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField — (a) a pick after a search reaches the field (objectui#13162)', () => {
  it('Enter after the answer lands takes the first match, which is the active row — no arrow key needed', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} />);
    await settle();
    await openDropdown();
    await typeSearch('mar');
    await waitOutDebounce();
    expect(optionTitles()).toEqual(['Marta Quinn']);
    // The match is announced as the active row before any key is pressed.
    const active = screen.getByRole('combobox').getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveAttribute('title', 'Marta Quinn');

    await press('Enter');
    expect(hostValue()).toBe('u2');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('an arrow key pressed before the answer lands does not void Enter: Enter takes the answer\'s first match', async () => {
    const backend = makeBackend({ holdSearch: true });
    render(<Host ds={backend.ds} />);
    await settle();
    await openDropdown();
    await typeSearch('mar');
    await waitOutDebounce();
    expect(backend.searchCalls()).toHaveLength(1);
    // Still the unsearched rows: the answer is held.
    expect(optionTitles()).toEqual(['Dev Admin', 'Marta Quinn', 'Priya Raman']);
    await press('ArrowDown');

    await backend.release();
    expect(optionTitles()).toEqual(['Marta Quinn']);
    await press('Enter');
    expect(hostValue()).toBe('u2');
  });

  it('Enter while the answer is pending takes nothing — never a row the typed term did not ask for', async () => {
    const backend = makeBackend({ holdSearch: true });
    render(<Host ds={backend.ds} />);
    await settle();
    await openDropdown();
    await typeSearch('mar');
    await waitOutDebounce();
    expect(backend.searchCalls()).toHaveLength(1);
    // The rows on screen answer the EMPTY term; none of them is made active.
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant');

    await press('Enter');
    expect(hostValue()).toBeNull();
    expect(optionTitles()).toEqual(['Dev Admin', 'Marta Quinn', 'Priya Raman']);
  });

  it('an authored option list narrows as the user types, and Enter takes its first match', async () => {
    function StaticHost() {
      const [value, setValue] = React.useState<unknown>(null);
      return (
        <>
          <LookupField
            value={value}
            onChange={(v: unknown) => setValue(v)}
            field={{
              name: 'managerId',
              options: [
                { value: 'a', label: 'Alpha' },
                { value: 'b', label: 'Beta' },
              ],
            } as never}
          />
          <output data-testid="host-value">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<StaticHost />);
    await act(async () => {
      fireEvent.click(trigger());
    });
    await settle();
    await typeSearch('be');
    await settle();
    expect(optionTitles()).toEqual(['Beta']);
    await press('Enter');
    expect(hostValue()).toBe('b');
    expect(trigger()).toHaveTextContent('Beta');
  });

  it('control: a click on a row after a search commits it', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} />);
    await settle();
    await openDropdown();
    await typeSearch('mar');
    await waitOutDebounce();
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Marta Quinn/ }));
    });
    await settle();
    expect(hostValue()).toBe('u2');
  });
});

describe('LookupField — (b) the trigger shows the picked record (objectui#13162)', () => {
  it('a pick without a search: the trigger reads the record\'s label, not "Select…", with no second read of it', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} />);
    await settle();
    expect(trigger()).toHaveTextContent('Select…');
    await openDropdown();
    const readsBeforePick = backend.ds.find.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Priya Raman/ }));
    });
    await settle();

    expect(hostValue()).toBe('u3');
    expect(trigger()).toHaveTextContent('Priya Raman');
    expect(trigger()).not.toHaveTextContent('Select…');
    // The option row carried the label: nothing is read again to draw it.
    expect(backend.ds.findOne).not.toHaveBeenCalled();
    expect(backend.ds.find.mock.calls.length).toBe(readsBeforePick);
    // Drawn once — the single-select field has no chip repeating it.
    expect(screen.getAllByText('Priya Raman')).toHaveLength(1);
  });

  it('a pick after a search: the trigger reads the record\'s label', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} />);
    await settle();
    await openDropdown();
    await typeSearch('mar');
    await waitOutDebounce();
    await press('Enter');
    expect(trigger()).toHaveTextContent('Marta Quinn');
    expect(trigger()).not.toHaveTextContent('Select…');
  });

  it('a value the record already holds is drawn in the trigger once it hydrates', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} initial="u1" />);
    await waitFor(() => expect(trigger()).toHaveTextContent('Dev Admin'));
    expect(trigger()).not.toHaveTextContent('Select…');
  });

  it('a search-first (people) single-select field draws the avatar and the name in its trigger', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} initial="u2" field={{ picker: 'search' }} />);
    await waitFor(() => expect(trigger()).toHaveTextContent('Marta Quinn'));
    // The avatar's initials, which the single-select chip used to draw.
    expect(trigger()).toHaveTextContent('MQ');
    expect(screen.queryByTestId('people-field-chip')).toBeNull();
  });

  it('control: clearing still clears — the clear control keeps its name, "Remove" and the label', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} initial="u2" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Marta Quinn' })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Marta Quinn' }));
    });
    await settle();
    expect(hostValue()).toBeNull();
    expect(trigger()).toHaveTextContent('Select…');
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('control: a disabled field draws its value and offers no clear control', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} initial="u2" disabled />);
    await waitFor(() => expect(screen.getByText('Marta Quinn')).toBeInTheDocument());
    expect(trigger()).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('control: "Browse all records" still sets the value, and the value is drawn', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-all-records'));
    });
    await waitFor(() => expect(screen.getByTestId('record-row-u2')).toBeInTheDocument());
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-u2'));
    });
    await settle();
    expect(hostValue()).toBe('u2');
    expect(screen.getByText('Marta Quinn')).toBeInTheDocument();
  });

  it('control: a multi-select field keeps its chips and its "N selected" trigger', async () => {
    const backend = makeBackend();
    render(<Host ds={backend.ds} initial={['u1', 'u2']} field={{ multiple: true }} />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label')),
      ).toEqual(['Remove Dev Admin', 'Remove Marta Quinn']),
    );
    expect(trigger()).toHaveTextContent('2 selected');
    expect(screen.queryByTestId('lookup-clear')).toBeNull();
  });
});

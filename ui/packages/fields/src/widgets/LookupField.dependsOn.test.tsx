/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dependent (cascading) lookups — #2215.
 *
 * A lookup with `dependsOn` must:
 *  1. gate every candidate surface while a dependency is empty,
 *  2. unlock as soon as the dependent values arrive (the form renderer
 *     injects live form values via the `dependentValues` prop), and
 *  3. scope EVERY candidate query — quick-select popover, Level-2 table
 *     picker and PeoplePicker — with the dependent-lookup chain as a hard
 *     `$filter` no user filter input can override.
 *
 * Pre-fix, `dependentValues` was never injected by the form renderer (the
 * context fallback read a member that does not exist), so create-mode
 * cascades stayed gated forever; and the table picker only received
 * `lookupFilters`, listing the full unfiltered record set.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LookupField } from './LookupField';
import { RecordPickerDialog } from './RecordPickerDialog';
import { PeoplePicker } from './PeoplePicker';

const contacts = [
  { id: 'c1', name: 'Nora Field', account: 'a1' },
  { id: 'c2', name: 'Oscar Grant', account: 'a2' },
];

function makeDataSource() {
  const find = vi.fn(async (_obj: string, params: any) => {
    const account = params?.$filter?.account ?? params?.$filter?.account_id;
    const data = account ? contacts.filter(c => c.account === account) : contacts;
    return { data, total: data.length };
  });
  return { find } as any;
}

beforeEach(() => {
  // jsdom has no matchMedia; PeoplePicker's useIsMobile needs it.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

describe('LookupField — dependsOn gating and cascade filter (#2215)', () => {
  const dependentField = {
    name: 'contact',
    label: 'Contact',
    reference: 'contacts',
    reference_field: 'name',
    dependsOn: ['account'],
  } as any;

  it('gates the trigger while the dependency is empty', () => {
    render(
      <LookupField
        field={dependentField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={makeDataSource()}
        {...({ dependentValues: { account: null } } as any)}
      />,
    );

    const trigger = screen.getByTestId('lookup-trigger-gated');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent(/select account first/i);
  });

  it('unlocks when dependentValues carry the parent value and scopes the popover query', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={dependentField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
        {...({ dependentValues: { account: 'a1' } } as any)}
      />,
    );

    const trigger = screen.getByRole('button', { name: /select/i });
    expect(trigger).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(trigger);
    });

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith(
        'contacts',
        expect.objectContaining({ $filter: expect.objectContaining({ account: 'a1' }) }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Nora Field')).toBeInTheDocument();
      expect(screen.queryByText('Oscar Grant')).not.toBeInTheDocument();
    });
  });

  it('maps the explicit { field, param } shape onto the remote filter field', async () => {
    const ds = makeDataSource();
    const explicitField = {
      ...dependentField,
      dependsOn: [{ field: 'account', param: 'account_id' }],
    };
    render(
      <LookupField
        field={explicitField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
        {...({ dependentValues: { account: 'a1' } } as any)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith(
        'contacts',
        expect.objectContaining({ $filter: expect.objectContaining({ account_id: 'a1' }) }),
      );
    });
  });
});

describe('RecordPickerDialog — baseFilter is a hard constraint (#2215)', () => {
  it('applies baseFilter over the lookupFilters base on the same field', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        lookupFilters={[{ field: 'account', operator: 'eq', value: 'stale' }]}
        baseFilter={{ account: 'a1' }}
      />,
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalled();
    });
    const lastParams = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(lastParams.$filter).toMatchObject({ account: 'a1' });
  });

  it('cannot be widened back out by filter-bar input on the same field', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        lookupFilters={[{ field: 'account', operator: 'eq', value: 'stale' }]}
        baseFilter={{ account: 'a1' }}
      />,
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalled();
    });

    // Open the filter bar (auto-derived from lookupFilters) and try to
    // override the cascaded field by hand.
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    const panel = await screen.findByTestId('record-picker-filter-panel');
    const input = panel.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'a2' } });

    // The hard constraint wins: no query may ever go out with the user's
    // widened value.
    await waitFor(() => {
      for (const call of ds.find.mock.calls) {
        expect(call[1]?.$filter?.account).toBe('a1');
      }
    });
  });
});

describe('PeoplePicker — baseFilter scopes the candidate query (#2215)', () => {
  it('merges baseFilter after lookupFilters so the cascade wins', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        lookupFilters={[{ field: 'account', operator: 'eq', value: 'stale' }]}
        baseFilter={{ account: 'a1' }}
      />,
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalled();
    });
    const lastParams = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(lastParams.$filter).toMatchObject({ account: 'a1' });
  });
});

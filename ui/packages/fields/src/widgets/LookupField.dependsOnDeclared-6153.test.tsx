// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A lookup whose METADATA carries `dependsOn` scopes its candidates — read
 * through the DECLARED type (objectui#6153, instance 1; maintainer ruling A,
 * 2026-09-02).
 *
 * `LookupField.dependsOn.test.tsx` (#2215) proves the gate and the hard
 * `$filter` on an `as any` literal — an untyped host bag.
 * This file proves the same two facts through the spec's field-level spelling
 * on ANNOTATED `LookupFieldMetadata` literals with NO cast — the
 * excess-property check refused `dependsOn` on this exact document before the
 * declaration landed (compile half), and the widget still gates and scopes on
 * it (runtime half). objectui#7357 has since retired the snake_case twin
 * `depends_on`, so this spelling is now the only one the widget reads.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LookupFieldMetadata } from '@object-ui/types';
import { LookupField } from './LookupField';

const contacts = [
  { id: 'c1', name: 'Nora Field', account: 'a1' },
  { id: 'c2', name: 'Oscar Grant', account: 'a2' },
];

function makeDataSource() {
  const find = vi.fn(async (_obj: string, params: { $filter?: Record<string, unknown> } | undefined) => {
    const account = params?.$filter?.account ?? params?.$filter?.account_id;
    const data = account ? contacts.filter((c) => c.account === account) : contacts;
    return { data, total: data.length };
  });
  return { find } as never;
}

beforeEach(() => {
  // jsdom has no matchMedia; the people-picker branch's useIsMobile needs it.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as never;
});

// The literal `content/docs/fields/lookup.mdx` teaches — annotated, uncast.
const contactField: LookupFieldMetadata = {
  type: 'lookup',
  name: 'contact',
  label: 'Contact',
  reference: 'contacts',
  reference_field: 'name',
  dependsOn: [{ field: 'account', param: 'account_id' }],
};

const shorthandField: LookupFieldMetadata = {
  ...contactField,
  dependsOn: ['account'],
};

// `dependentValues` is a HOST prop (the form renderer's channel), not metadata.
const host = (dependentValues: Record<string, unknown>) => ({ dependentValues }) as Record<string, unknown>;

describe('LookupField — `dependsOn` off the DECLARED metadata type (objectui#6153)', () => {
  it('gates the trigger while the controlling field is empty', () => {
    render(
      <LookupField
        field={contactField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={makeDataSource()}
        {...host({ account: null })}
      />,
    );
    const trigger = screen.getByTestId('lookup-trigger-gated');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent(/select account first/i);
  });

  it('scopes the candidate query by the `{ field, param }` entry once the parent is set', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={contactField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
        {...host({ account: 'a1' })}
      />,
    );

    const trigger = screen.getByRole('button', { name: /select/i });
    expect(trigger).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(trigger);
    });

    await waitFor(() => {
      expect((ds as { find: ReturnType<typeof vi.fn> }).find).toHaveBeenCalledWith(
        'contacts',
        expect.objectContaining({ $filter: expect.objectContaining({ account_id: 'a1' }) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Nora Field')).toBeInTheDocument();
      expect(screen.queryByText('Oscar Grant')).not.toBeInTheDocument();
    });
  });

  it('the shorthand `[name]` entry filters by the sibling name itself', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={shorthandField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
        {...host({ account: 'a1' })}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });
    await waitFor(() => {
      expect((ds as { find: ReturnType<typeof vi.fn> }).find).toHaveBeenCalledWith(
        'contacts',
        expect.objectContaining({ $filter: expect.objectContaining({ account: 'a1' }) }),
      );
    });
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserField } from './UserField';

const USERS = [
  { id: 'u1', name: 'Amy Lin', email: 'amy@x.io', image: 'http://x/amy.png', primary_business_unit_id: { name: 'Sales' } },
  { id: 'u2', name: 'Bob Wu', email: 'bob@x.io', primary_business_unit_id: { name: 'Eng' } },
];

function makeDataSource() {
  return {
    find: vi.fn(async (_obj: string, params: any = {}) => {
      const idIn = params?.$filter?.id?.$in as any[] | undefined;
      if (idIn) {
        const s = new Set(idIn.map(String));
        const data = USERS.filter(u => s.has(String(u.id)));
        return { data, total: data.length };
      }
      const search: string | undefined = params?.$search;
      const data = search
        ? USERS.filter(u => u.name.toLowerCase().includes(search.toLowerCase()))
        : USERS;
      return { data, total: data.length };
    }),
  } as any;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('UserField — search-first entry (P0)', () => {
  it('opens the PeoplePicker from the primary trigger (no separate browse-all button)', async () => {
    const ds = makeDataSource();
    render(<UserField field={{ type: 'user' } as any} dataSource={ds} value={null} onChange={vi.fn()} />);

    // The redundant "browse all" icon is not rendered for search-first fields.
    expect(screen.queryByTestId('browse-all-records')).toBeNull();

    // Primary click opens the rich PeoplePicker (its search box appears).
    fireEvent.click(screen.getByTestId('lookup-trigger'));
    await waitFor(() => expect(screen.getByTestId('people-picker-search')).toBeTruthy());
  });

  it('renders the current selection as avatar chips', async () => {
    const ds = makeDataSource();
    render(
      <UserField field={{ type: 'user', multiple: true } as any} dataSource={ds} value={['u1']} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('people-field-chip')).toBeTruthy());
    expect(screen.getByText('Amy Lin')).toBeTruthy();
    // Initials fallback renders (image does not load in jsdom).
    expect(screen.getByText('AL')).toBeTruthy();
  });
});

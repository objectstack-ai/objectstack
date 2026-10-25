/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeoplePicker } from './PeoplePicker';
import { pushRecentLookupId } from './recentLookups';

const users = [
  { id: 'u1', name: 'Amy Lin', email: 'amy@x.io', primary_business_unit_id: { name: 'Sales' } },
  { id: 'u2', name: 'Bob Wu', email: 'bob@x.io' },
  { id: 'u3', name: 'Cara Xu', email: 'cara@x.io' },
];

function makeDataSource() {
  const find = vi.fn(async (_obj: string, params: any) => {
    const idIn = params?.$filter?.id?.$in as any[] | undefined;
    if (idIn) {
      const set = new Set(idIn.map(String));
      const data = users.filter(u => set.has(String(u.id)));
      return { data, total: data.length };
    }
    const search: string | undefined = params?.$search;
    const data = search
      ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()))
      : users;
    return { data, total: data.length };
  });
  return { find } as any;
}

const baseProps = {
  open: true,
  objectName: 'sys_user',
  subtitleFields: ['primary_business_unit_id.name', 'email'],
};

beforeEach(() => {
  // jsdom has no matchMedia; useIsMobile needs it. Default to desktop width.
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

describe('PeoplePicker', () => {
  it('lists candidate rows on open and filters by $search', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker
        {...baseProps}
        dataSource={ds}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    expect(screen.getByText('Sales · amy@x.io')).toBeTruthy();
    expect(screen.getAllByTestId('person-row')).toHaveLength(3);

    fireEvent.change(screen.getByTestId('people-picker-search'), { target: { value: 'amy' } });
    await waitFor(() => expect(screen.getAllByTestId('person-row')).toHaveLength(1));
    // Relation subtitle (primary_business_unit_id.name) auto-adds $expand.
    expect(ds.find).toHaveBeenLastCalledWith('sys_user', {
      $top: 25,
      $search: 'amy',
      $expand: ['primary_business_unit_id'],
    });
  });

  it('applies base candidate filters (banned != true)', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker
        {...baseProps}
        dataSource={ds}
        lookupFilters={[{ field: 'banned', operator: 'ne', value: true }]}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(ds.find).toHaveBeenCalledWith('sys_user', {
        $top: 25,
        $filter: { banned: { $ne: true } },
        $expand: ['primary_business_unit_id'],
      }),
    );
  });

  it('single-select commits immediately and closes', async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();
    const onSelectRecords = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PeoplePicker
        {...baseProps}
        dataSource={ds}
        onSelect={onSelect}
        onSelectRecords={onSelectRecords}
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());

    fireEvent.click(screen.getByText('Amy Lin'));
    expect(onSelect).toHaveBeenCalledWith('u1');
    expect(onSelectRecords).toHaveBeenCalledWith([users[0]]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('multi-select echoes chips and confirms ids + records', async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();
    const onSelectRecords = vi.fn();
    render(
      <PeoplePicker
        {...baseProps}
        multiple
        dataSource={ds}
        onSelect={onSelect}
        onSelectRecords={onSelectRecords}
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());

    fireEvent.click(screen.getByText('Amy Lin'));
    fireEvent.click(screen.getByText('Bob Wu'));
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(2));

    fireEvent.click(screen.getByText('Confirm'));
    expect(onSelect).toHaveBeenCalledWith(['u1', 'u2']);
    expect(onSelectRecords).toHaveBeenCalledWith([users[0], users[1]]);
  });

  it('surfaces recent contacts in their own section when idle', async () => {
    pushRecentLookupId('sys_user', 'u3');
    const ds = makeDataSource();
    render(
      <PeoplePicker
        {...baseProps}
        dataSource={ds}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Recently used')).toBeTruthy());
    // Cara appears under "Recently used" and is de-duped out of the main list.
    expect(screen.getByText('Cara Xu')).toBeTruthy();
    expect(screen.getByText('All results')).toBeTruthy();
  });

  it('keyboard: ArrowDown then Enter commits the active row (single)', async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();
    render(
      <PeoplePicker {...baseProps} dataSource={ds} onSelect={onSelect} onSelectRecords={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    const search = screen.getByTestId('people-picker-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    // Wait for the cursor to actually land on the first row before committing —
    // guards against a late background re-render swallowing the keypress (the
    // old identity-keyed cursor reset made this flaky on slow CI).
    await waitFor(() =>
      expect(screen.getAllByTestId('person-row')[0].getAttribute('data-active')).toBe('true'),
    );
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('u1');
  });

  it('keyboard: cursor resets when the results are replaced by a search', async () => {
    // Pins the semantics the render-phase reset must preserve: a NEW result
    // set does not inherit the previous set's cursor. (The reset moved out of
    // an effect into the render phase so it can never land AFTER a subsequent
    // ArrowDown — the CI flake on the test above.)
    const ds = makeDataSource();
    render(
      <PeoplePicker {...baseProps} dataSource={ds} onSelect={vi.fn()} onSelectRecords={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    const search = screen.getByTestId('people-picker-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getAllByTestId('person-row')[0].getAttribute('data-active')).toBe('true'),
    );
    fireEvent.change(search, { target: { value: 'bob' } });
    await waitFor(() => expect(screen.getAllByTestId('person-row')).toHaveLength(1));
    expect(screen.getAllByTestId('person-row')[0].getAttribute('data-active')).not.toBe('true');
  });

  it('keyboard: Backspace on empty search removes the last chip (multi)', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker {...baseProps} multiple dataSource={ds} onSelect={vi.fn()} onSelectRecords={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    fireEvent.click(screen.getByText('Amy Lin'));
    fireEvent.click(screen.getByText('Bob Wu'));
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(2));
    fireEvent.keyDown(screen.getByTestId('people-picker-search'), { key: 'Backspace' });
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(1));
  });

  it('multi: Clear all empties the tray', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker {...baseProps} multiple dataSource={ds} onSelect={vi.fn()} onSelectRecords={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    fireEvent.click(screen.getByText('Amy Lin'));
    fireEvent.click(screen.getByText('Bob Wu'));
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(2));
    fireEvent.click(screen.getByTestId('selection-clear'));
    await waitFor(() => expect(screen.queryAllByTestId('selection-chip')).toHaveLength(0));
  });

  it('highlights the matched term in rows while searching', async () => {
    const ds = makeDataSource();
    // Dialog content portals onto document.body, so query the document, not the
    // render container.
    render(<PeoplePicker {...baseProps} dataSource={ds} onSelect={vi.fn()} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    fireEvent.change(screen.getByTestId('people-picker-search'), { target: { value: 'amy' } });
    await waitFor(() => expect(document.querySelector('mark')).toBeTruthy());
    expect(document.querySelector('mark')?.textContent?.toLowerCase()).toContain('am');
  });

  it('shows an error with a retry that refetches', async () => {
    let calls = 0;
    const ds = {
      find: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return { data: [users[0]], total: 1 };
      }),
    } as any;
    render(
      <PeoplePicker {...baseProps} dataSource={ds} onSelect={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
  });

  it('renders a Dialog on desktop and a bottom Sheet on mobile', async () => {
    const ds = makeDataSource();
    const { unmount } = render(
      <PeoplePicker {...baseProps} dataSource={ds} onSelect={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('people-picker-dialog')).toBeTruthy());
    expect(screen.queryByTestId('people-picker-sheet')).toBeNull();
    unmount();

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    render(<PeoplePicker {...baseProps} dataSource={ds} onSelect={vi.fn()} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('people-picker-sheet')).toBeTruthy());
    expect(screen.queryByTestId('people-picker-dialog')).toBeNull();
  });

  it('seeds the tray from an existing multi value (edit mode)', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker
        {...baseProps}
        multiple
        dataSource={ds}
        value={['u1']}
        onSelect={vi.fn()}
        onSelectRecords={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(1));
    expect(screen.getByTestId('selection-tray').textContent).toContain('Amy Lin');
  });

  it('inline: renders an anchored popover, not a modal dialog', async () => {
    const ds = makeDataSource();
    render(
      <PeoplePicker
        {...baseProps}
        inline
        trigger={<button data-testid="inline-trigger">open</button>}
        dataSource={ds}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('people-picker-inline')).toBeTruthy());
    expect(screen.queryByTestId('people-picker-dialog')).toBeNull();
    expect(screen.getByTestId('inline-trigger')).toBeTruthy();
  });

  it('inline multi: toggling a row commits live, with no confirm button', async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();
    render(
      <PeoplePicker
        {...baseProps}
        inline
        multiple
        value={[]}
        dataSource={ds}
        trigger={<button data-testid="inline-trigger" />}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
        onSelectRecords={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    // Inline has no staging tray / confirm — selection lives in the field chips.
    expect(screen.queryByText('Confirm')).toBeNull();
    fireEvent.click(screen.getByText('Amy Lin'));
    expect(onSelect).toHaveBeenLastCalledWith(['u1']);
    fireEvent.click(screen.getByText('Bob Wu'));
    expect(onSelect).toHaveBeenLastCalledWith(['u1', 'u2']);
  });

  it('inline single: clicking a row commits and closes', async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PeoplePicker
        {...baseProps}
        inline
        dataSource={ds}
        trigger={<button data-testid="inline-trigger" />}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        onSelectRecords={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    fireEvent.click(screen.getByText('Amy Lin'));
    expect(onSelect).toHaveBeenCalledWith('u1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

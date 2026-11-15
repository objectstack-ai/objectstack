/**
 * objectstack#33826 — a record deleted in the console leaves the
 * recently-accessed list that the command palette and Home read.
 *
 * The one subscriber that drops it, `useDropDeletedRecordsFromRecents`, is
 * mounted once, in `ConnectedShellInner`, on the connected adapter's mutation
 * events. This pins that mount: the console's provider stack holds the
 * recents above the shell (`ConsoleShell` wraps every `ConnectedShell`), the
 * adapter reports a delete the way `ObjectStackAdapter.delete` does, and the
 * probe stands where the palette and Home read the list.
 *
 * What is real: `ConnectedShell` and everything it mounts, the recents
 * provider and its storage. The adapter is a fake that serves the shell's
 * metadata reads and reports mutations; the session is resolved, signed out,
 * so no preference row is attached.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataSourceMutationEvent } from '@object-ui/types';

const listeners = vi.hoisted(() => new Set<(e: { type: string; resource: string; id?: string }) => void>());

const fakeAdapter = vi.hoisted(() => ({
  clearCache: () => {},
  getObjectSchema: async () => null,
  getClient: () => ({
    meta: {
      getItems: (type: string) => Promise.resolve({ type, items: [] }),
      getItem: () => Promise.resolve({ item: null }),
    },
  }),
  onMutation: (cb: (e: { type: string; resource: string; id?: string }) => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: null,
    session: null,
    isAuthenticated: false,
    isLoading: false,
    isAuthEnabled: true,
    error: null,
  }),
  createAuthenticatedFetch: () => globalThis.fetch,
}));

// The adapter is not under test: the shell hands the fake to every
// `useAdapter()` reader.
vi.mock('../../providers/AdapterProvider', () => ({
  AdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdapter: () => fakeAdapter,
}));

import { ConnectedShell } from '../ConsoleShell';
import { RecentItemsProvider, useRecentItems, type RecentItem } from '../../context/RecentItemsProvider';
import { UserStateAdaptersProvider } from '../../context/UserStateAdapters';

const KEY = 'objectui-recent-items';

/** Stands where the palette and Home read the list. */
function RecentsProbe() {
  const { recentItems } = useRecentItems();
  return <ul data-testid="recents">{recentItems.map((r) => <li key={r.id}>{r.id}</li>)}</ul>;
}

function emit(e: DataSourceMutationEvent) {
  listeners.forEach((cb) => cb(e as never));
}

const seeded: RecentItem[] = [
  { id: 'record:crm_account:a1', type: 'record', label: 'Browser Test Co', href: '/apps/crm/crm_account/record/a1', visitedAt: '2026-11-15T00:00:02Z' },
  { id: 'record:crm_account:b2', type: 'record', label: 'Globex', href: '/apps/crm/crm_account/record/b2', visitedAt: '2026-11-15T00:00:01Z' },
];

function renderConsole() {
  return render(
    <UserStateAdaptersProvider>
      <RecentItemsProvider>
        <MemoryRouter>
          <ConnectedShell>
            <RecentsProbe />
          </ConnectedShell>
        </MemoryRouter>
      </RecentItemsProvider>
    </UserStateAdaptersProvider>,
  );
}

function listed(): string[] {
  return Array.from(screen.getByTestId('recents').querySelectorAll('li')).map((li) => li.textContent ?? '');
}

describe('ConnectedShell — a deleted record leaves the recents (objectstack#33826)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify(seeded));
  });
  afterEach(() => {
    cleanup();
    listeners.clear();
  });

  it('the delete the adapter reports drops that record, and only that one', async () => {
    renderConsole();
    await screen.findByTestId('recents');
    expect(listed()).toEqual(['record:crm_account:a1', 'record:crm_account:b2']);

    act(() => emit({ type: 'delete', resource: 'crm_account', id: 'a1' }));

    expect(listed()).toEqual(['record:crm_account:b2']);
    expect(JSON.parse(localStorage.getItem(KEY)!).map((r: RecentItem) => r.id)).toEqual(['record:crm_account:b2']);
  });

  it('control: with the shell unmounted, nothing listens', async () => {
    const view = renderConsole();
    await screen.findByTestId('recents');
    expect(listeners.size).toBeGreaterThan(0);
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});

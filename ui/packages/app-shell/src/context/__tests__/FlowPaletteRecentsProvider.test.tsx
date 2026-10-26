/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUser = { current: { id: 'user-1', name: 'Alice', email: 'a@x' } as any | null };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: mockUser.current, isAuthenticated: !!mockUser.current, isLoading: false }),
}));

import {
  FlowPaletteRecentsProvider,
  useFlowPaletteRecents,
} from '../FlowPaletteRecentsProvider';
import {
  UserStateAdaptersProvider,
  useAttachUserStateAdapters,
  type UserDataAdapter,
} from '../UserStateAdapters';

function makeAdapter(initial: string[] = []) {
  const loadMock = vi.fn().mockResolvedValue(initial);
  const saveMock = vi.fn().mockResolvedValue(undefined);
  return { load: loadMock, save: saveMock, loadMock, saveMock } as UserDataAdapter<string> & {
    loadMock: ReturnType<typeof vi.fn>;
    saveMock: ReturnType<typeof vi.fn>;
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <FlowPaletteRecentsProvider>{children}</FlowPaletteRecentsProvider>
    </UserStateAdaptersProvider>
  );
}

function useHarness() {
  const attach = useAttachUserStateAdapters();
  const recents = useFlowPaletteRecents();
  return { attach, recents };
}

describe('FlowPaletteRecentsProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'user-1', name: 'Alice', email: 'a@x' } as any;
  });

  it('hydrates synchronously from user-scoped localStorage on mount', () => {
    localStorage.setItem('flow-palette-recents:u:user-1', JSON.stringify(['screen', 'http']));
    const { result } = renderHook(() => useFlowPaletteRecents(), { wrapper });
    expect(result.current.recents).toEqual(['screen', 'http']);
  });

  it('recordRecent moves the type to the front, deduped', () => {
    const { result } = renderHook(() => useFlowPaletteRecents(), { wrapper });
    act(() => result.current.recordRecent('a'));
    act(() => result.current.recordRecent('b'));
    act(() => result.current.recordRecent('a'));
    expect(result.current.recents).toEqual(['a', 'b']);
  });

  it('caps the list at 5', () => {
    const { result } = renderHook(() => useFlowPaletteRecents(), { wrapper });
    act(() => {
      for (let i = 0; i < 8; i++) result.current.recordRecent(`t-${i}`);
    });
    expect(result.current.recents).toHaveLength(5);
    expect(result.current.recents[0]).toBe('t-7');
  });

  it('persists to user-scoped localStorage only', () => {
    const { result } = renderHook(() => useFlowPaletteRecents(), { wrapper });
    act(() => result.current.recordRecent('screen'));
    // The unscoped legacy key is never written for a signed-in user.
    expect(localStorage.getItem('flow-palette-recents')).toBeNull();
    expect(JSON.parse(localStorage.getItem('flow-palette-recents:u:user-1') || '[]')).toEqual([
      'screen',
    ]);
  });

  it('migrates the legacy unscoped key into the scoped list and clears it', async () => {
    // Written by the pre-cloud-sync localStorage-only version.
    localStorage.setItem('flow-palette-recents', JSON.stringify(['legacy1', 'legacy2']));
    const { result } = renderHook(() => useFlowPaletteRecents(), { wrapper });
    await waitFor(() => {
      expect(result.current.recents).toEqual(['legacy1', 'legacy2']);
    });
    // Legacy key consumed + removed; scoped key now holds the data.
    expect(localStorage.getItem('flow-palette-recents')).toBeNull();
    expect(JSON.parse(localStorage.getItem('flow-palette-recents:u:user-1') || '[]')).toEqual([
      'legacy1',
      'legacy2',
    ]);
  });

  it('hydrates from the adapter and overrides localStorage state', async () => {
    localStorage.setItem('flow-palette-recents:u:user-1', JSON.stringify(['local']));
    const adapter = makeAdapter(['remote1', 'remote2']);

    const { result } = renderHook(() => useHarness(), { wrapper });
    expect(result.current.recents.recents).toEqual(['local']);

    act(() => result.current.attach('flowPaletteRecents', adapter));

    await waitFor(() => {
      expect(result.current.recents.recents).toEqual(['remote1', 'remote2']);
    });
    expect(JSON.parse(localStorage.getItem('flow-palette-recents:u:user-1') || '[]')).toEqual([
      'remote1',
      'remote2',
    ]);
  });

  it('debounces adapter.save() across a burst of picks', async () => {
    const adapter = makeAdapter([]);
    const { result } = renderHook(() => useHarness(), { wrapper });

    act(() => result.current.attach('flowPaletteRecents', adapter));
    await waitFor(() => expect(adapter.loadMock).toHaveBeenCalled());
    adapter.saveMock.mockClear();

    act(() => {
      result.current.recents.recordRecent('1');
      result.current.recents.recordRecent('2');
      result.current.recents.recordRecent('3');
    });

    expect(adapter.saveMock).not.toHaveBeenCalled();
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(adapter.saveMock.mock.calls[0][0]).toEqual(['3', '2', '1']);
  });

  it('falls back to the localStorage module outside a provider', () => {
    localStorage.setItem('flow-palette-recents', JSON.stringify(['fallback']));
    const { result } = renderHook(() => useFlowPaletteRecents());
    expect(result.current.recents).toEqual(['fallback']);
    act(() => result.current.recordRecent('new'));
    expect(result.current.recents).toEqual(['new', 'fallback']);
    // Fallback writes the unscoped legacy/localStorage key.
    expect(JSON.parse(localStorage.getItem('flow-palette-recents') || '[]')).toEqual([
      'new',
      'fallback',
    ]);
  });
});

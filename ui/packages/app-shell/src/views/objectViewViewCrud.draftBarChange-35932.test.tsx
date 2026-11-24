// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35932 — the draft bar's Publish or Discard drops the list's
 * local copy of the draft once the saved views have been read again.
 *
 * A draft save keeps the list mounted, so the copy a save put on screen
 * (`viewDraft`) is no longer dropped by a remount. After Publish or Discard the
 * stored view is what the list must show: the handler bumps the refresh
 * counter (the saved views are read again) and drops the copy in the commit
 * that installs that read, never before it, so the list does not fall back to
 * the read from before the publish.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));

// The module reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { useObjectViewViewCrud } from './objectViewViewCrud';

type Args = Parameters<typeof useObjectViewViewCrud>[0];

function mount() {
  const setViewDraft = vi.fn();
  const setRefreshKey = vi.fn();
  const base = {
    dataSource: {} as Args['dataSource'],
    objects: [],
    navigate: vi.fn() as unknown as Args['navigate'],
    objectName: 'crm_account',
    viewId: 'crm_account.team',
    t: ((key: string) => key) as unknown as Args['t'],
    metadataClient: {} as Args['metadataClient'],
    previewDrafts: false as Args['previewDrafts'],
    setShowViewConfigPanel: vi.fn(),
    setViewConfigPanelMode: vi.fn(),
    setShowCreateViewDialog: vi.fn(),
    setViewDraft,
    setRefreshKey,
    confirmHandler: vi.fn() as unknown as Args['confirmHandler'],
    listLayout: { setViewOrder: vi.fn() } as unknown as Args['listLayout'],
    views: [],
    activeViewId: 'crm_account.team',
    baseView: { id: 'crm_account.team' } as Args['baseView'],
  };
  const hook = renderHook(
    ({ savedViews }: { savedViews: Args['savedViews'] }) => useObjectViewViewCrud({ ...base, savedViews }),
    {
      initialProps: { savedViews: [{ name: 'crm_account.team' }] as Args['savedViews'] },
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    },
  );
  return { hook, setViewDraft, setRefreshKey };
}

describe('objectstack#35932 — Publish or Discard drops the local draft once the views are read again', () => {
  it('reads the views again, and drops the copy when that read lands', () => {
    const { hook, setViewDraft, setRefreshKey } = mount();
    act(() => hook.result.current.handleDraftBarChange());
    expect(setRefreshKey).toHaveBeenCalledTimes(1);
    expect(setViewDraft).not.toHaveBeenCalled();

    hook.rerender({ savedViews: [{ name: 'crm_account.team', columns: ['name'] }] as Args['savedViews'] });
    expect(setViewDraft).toHaveBeenCalledTimes(1);
    expect(setViewDraft).toHaveBeenCalledWith(null);

    // Only that read: a later one leaves a later draft alone.
    hook.rerender({ savedViews: [{ name: 'crm_account.team' }] as Args['savedViews'] });
    expect(setViewDraft).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a saved-views read with no Publish or Discard before it keeps the copy', () => {
    const { hook, setViewDraft } = mount();
    hook.rerender({ savedViews: [{ name: 'crm_account.team', columns: ['name'] }] as Args['savedViews'] });
    expect(setViewDraft).not.toHaveBeenCalled();
  });
});

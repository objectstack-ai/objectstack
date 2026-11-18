// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35115 — a navigation write reads and saves a packaged app at its
 * package.
 *
 * `useNavigationSync` read the stored app (`getAuthoredItem('app', name)`) and
 * saved it (`client.meta.saveItem('app', name, body)`) with no package, so a
 * navigation write into an app a package owns went to the package-less
 * address (no `?package=`). The read, the save and the Undo now name the
 * served app's package (`{ packageId }`, sent as `?package=`); a package-less
 * app, and an app served with the server's `sys_metadata` sentinel, keep the
 * package-less address.
 *
 * Direction, written before the run: with the hook left package-less (the
 * unmodified tree) the packaged case goes RED on the read's and the save's
 * package while the package-less case stays GREEN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MetadataCtx, AdapterCtx, type MetadataContextValue } from '@object-ui/react';
import { toast } from 'sonner';
import { useNavigationSync } from '../useNavigationSync';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

/** The app as its author stored it. */
const STORED = {
  name: 'qa_scope_app',
  label: 'QA Scope App',
  navigation: [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'qa_scope_home' }],
};

function metaValue(apps: Record<string, unknown>[]): MetadataContextValue {
  return {
    apps,
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  } as unknown as MetadataContextValue;
}

/** Add a page to the navigation of every app, the way a page publish does. */
async function addPage(served: Record<string, unknown>) {
  const saveItem = vi.fn().mockResolvedValue({});
  const getAuthoredItem = vi.fn(async () => STORED);
  let done = false;
  function Site() {
    const { syncPageCreatedAllApps } = useNavigationSync();
    useEffect(() => {
      void syncPageCreatedAllApps('qa_scope_new_page').then(() => { done = true; });
      // Once, on mount: the write is the case.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  const adapter = { getClient: () => ({ meta: { saveItem } }), getAuthoredItem } as unknown as React.ComponentProps<
    typeof AdapterCtx.Provider
  >['value'];
  render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataCtx.Provider value={metaValue([served])}>
        <Site />
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>,
  );
  await waitFor(() => expect(done).toBe(true));
  return { saveItem, getAuthoredItem };
}

/** Press the success toast's Undo, and wait for its save. */
async function undo(saveItem: ReturnType<typeof vi.fn>) {
  const options = vi.mocked(toast.success).mock.calls[0]?.[1] as { action: { onClick: () => Promise<void> } };
  await options.action.onClick();
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('a navigation write addresses the app at its package (objectstack#35115)', () => {
  it('a packaged app is read, saved and undone at its package', async () => {
    const { saveItem, getAuthoredItem } = await addPage({ ...STORED, _packageId: 'com.qa.scope' });

    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app', { packageId: 'com.qa.scope' });
    expect(saveItem).toHaveBeenCalledTimes(1);
    const [type, name, body, options] = saveItem.mock.calls[0] as [string, string, any, unknown];
    expect([type, name, options]).toEqual(['app', 'qa_scope_app', { packageId: 'com.qa.scope' }]);
    // Control: the write's own change is what it carries.
    expect(body.navigation).toHaveLength(2);

    await undo(saveItem);
    expect(saveItem.mock.calls[1]?.[3]).toEqual({ packageId: 'com.qa.scope' });
    expect((saveItem.mock.calls[1]?.[2] as any).navigation).toHaveLength(1);
  });

  it('a package-less app is read, saved and undone with no package', async () => {
    const { saveItem, getAuthoredItem } = await addPage({ ...STORED });

    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app');
    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem.mock.calls[0]).toHaveLength(3);
    expect(saveItem.mock.calls[0]?.slice(0, 2)).toEqual(['app', 'qa_scope_app']);

    await undo(saveItem);
    expect(saveItem.mock.calls[1]).toHaveLength(3);
  });

  it('an app served with the sys_metadata sentinel names no package on the read or the save', async () => {
    const { saveItem, getAuthoredItem } = await addPage({ ...STORED, _packageId: 'sys_metadata' });

    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app');
    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem.mock.calls[0]).toHaveLength(3);
  });
});

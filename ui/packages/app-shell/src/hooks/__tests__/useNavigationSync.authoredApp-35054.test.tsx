// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35054 (route D) — a navigation write sends the app as its author
 * stored it, never the app as it is served.
 *
 * `useNavigationSync` found the app in the served list (`useMetadata().apps`),
 * which is translated for the console's locale, and wrote it back whole with
 * one navigation entry changed. The metadata door stores a body verbatim, so
 * in a zh-CN session every navigation write stored the app's label and every
 * existing navigation label in Chinese. Measured live: publishing an unrelated
 * new page from the home page's pending-drafts bar rewrote `qatr_app` that way.
 *
 * The served list now only finds the app; the body is read from the
 * untranslated layers (`adapter.getAuthoredItem`).
 *
 * Direction, written before the run: with the served app written back (the
 * unmodified tree) the first case goes RED on the stored label and the
 * existing navigation labels while the appended-entry control stays GREEN.
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

/** The app as its author stored it (en source). */
const SOURCE = {
  name: 'qatr_app',
  label: 'QA Translate App',
  navigation: [
    { id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'qatr_my_work' },
    { id: 'grp_workspace', type: 'group', label: 'Workspace', children: [{ id: 'nav_gallery', type: 'dashboard', label: 'Chart Gallery', dashboardName: 'qatr_chart_gallery' }] },
  ],
};

/** The same app as the zh-CN list serves it. */
const SERVED = {
  ...SOURCE,
  label: '翻译测试应用',
  navigation: [
    { ...SOURCE.navigation[0], label: '我的工作' },
    { ...SOURCE.navigation[1], label: '工作区', children: [{ ...SOURCE.navigation[1].children![0], label: '图表画廊' }] },
  ],
  _packageId: 'com.qa.tr',
};

function metaValue(): MetadataContextValue {
  return {
    apps: [SERVED],
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

const navLabels = (nav: any[]): unknown[] => nav.map((n) => (n.children ? [n.label, navLabels(n.children)] : n.label));

async function addPage(getAuthoredItem: ReturnType<typeof vi.fn>) {
  const saveItem = vi.fn().mockResolvedValue({});
  let done = false;
  function Site() {
    const { syncPageCreatedAllApps } = useNavigationSync();
    useEffect(() => {
      void syncPageCreatedAllApps('qatr_new_page').then(() => { done = true; });
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
      <MetadataCtx.Provider value={metaValue()}>
        <Site />
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>,
  );
  await waitFor(() => expect(done).toBe(true));
  return saveItem;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('a navigation write sends the authored app (objectstack#35054)', () => {
  it('a zh-CN page create stores the source label and navigation labels, and the new entry is appended', async () => {
    const getAuthoredItem = vi.fn(async () => SOURCE);
    const saveItem = await addPage(getAuthoredItem);

    // Read at the app's package (objectstack#35115), the address the save names.
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qatr_app', { packageId: 'com.qa.tr' });
    expect(saveItem).toHaveBeenCalledTimes(1);
    const [type, name, body] = saveItem.mock.calls[0] as [string, string, any];
    expect([type, name]).toEqual(['app', 'qatr_app']);
    expect(body.label).toBe('QA Translate App');
    expect(navLabels(body.navigation.slice(0, 2))).toEqual(['My Work', ['Workspace', ['Chart Gallery']]]);
    // Control: the write's own change is what it carries.
    expect(body.navigation).toHaveLength(3);
    expect(body.navigation[2]).toMatchObject({ type: 'page', pageName: 'qatr_new_page' });
    expect(body).not.toHaveProperty('_packageId');
  });

  it('an app with nothing stored to read is not written from the served copy', async () => {
    const getAuthoredItem = vi.fn(async () => {
      throw Object.assign(new Error('Layered read refused'), { status: 403 });
    });
    const saveItem = await addPage(getAuthoredItem);

    expect(saveItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

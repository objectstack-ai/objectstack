// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35054 (route D) — Publish sends the app as its author stored it.
 *
 * The bar's Publish wrote `{ ...servedApp, _unpublished: false }`. The served
 * app is translated for the console's locale, and the metadata door stores a
 * body verbatim, so publishing in a zh-CN session stored the app's label and
 * every navigation label in Chinese. Measured live on `qatr_hidden`.
 *
 * The body is now the stored app (`adapter.getAuthoredItem`, the untranslated
 * layers) with only the publish flag changed.
 *
 * Direction, written before the run: with the served app spread into the body
 * (the unmodified tree) the first case goes RED on the label and navigation
 * labels while the `_unpublished` control stays GREEN.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';

vi.mock('../PreviewModeContext', () => ({
  usePreviewDrafts: () => false,
  markPreviewExit: vi.fn(),
  PREVIEW_QUERY_FLAG: 'preview',
}));
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
  };
});

const { refresh, getAuthoredItem, SOURCE, SERVED } = vi.hoisted(() => {
  const SOURCE = {
    name: 'qatr_hidden',
    label: 'QA Hidden App',
    navigation: [{ id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'qatr_my_work' }],
  };
  const SERVED = {
    ...SOURCE,
    label: '隐藏测试应用',
    navigation: [{ ...SOURCE.navigation[0], label: '我的工作' }],
    _unpublished: true,
    _packageId: 'com.qa.tr',
  };
  return { refresh: vi.fn(), getAuthoredItem: vi.fn(), SOURCE, SERVED };
});
vi.mock('../../providers/MetadataProvider', () => ({ useMetadata: () => ({ apps: [SERVED], refresh }) }));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({ getAuthoredItem }) }));
vi.mock('../CommitTimeline', () => ({ CommitTimeline: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UnpublishedAppBar } from '../UnpublishedAppBar';

function publish() {
  render(
    <MemoryRouter initialEntries={['/apps/qatr_hidden']}>
      <UnpublishedAppBar />
    </MemoryRouter>,
  );
  screen.getByTestId('unpublished-app-publish').click();
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  getAuthoredItem.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('Publish sends the authored app (objectstack#35054)', () => {
  it('a zh-CN Publish stores the source label and navigation labels, and the publish flag flips', async () => {
    getAuthoredItem.mockResolvedValue({ ...SOURCE, _unpublished: true });
    publish();

    await waitFor(() => expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qatr_hidden');
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/meta/app/qatr_hidden');
    const body = JSON.parse(String(init.body));
    expect(body.label).toBe('QA Hidden App');
    expect(body.navigation.map((n: any) => n.label)).toEqual(['My Work']);
    // Control: the one key this write decides.
    expect(body._unpublished).toBe(false);
    expect(body).not.toHaveProperty('_packageId');
  });

  it('an app with nothing stored to read is not published from the served copy', async () => {
    getAuthoredItem.mockResolvedValue(null);
    publish();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

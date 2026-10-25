/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12968 (objectstack#24324 ruling A, preview-first).
 *
 *  (a) the deep-link table: one row per draft kind, every row under
 *      `?preview=draft`, the app row the URL the Live Canvas already opens;
 *  (b) the DraftPreviewBar's pending line names what is pending on the surface
 *      it shows, on a page and on an object list;
 *  (c) CONTROL: outside draft preview the bar draws nothing, and on a route
 *      with no surface of its own the bar keeps today's message.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const previewState = vi.hoisted(() => ({ on: true }));
vi.mock('../PreviewModeContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePreviewDrafts: () => previewState.on,
  markPreviewExit: vi.fn(),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string; count?: number }) =>
      (o?.defaultValue ?? _k).replace('{{count}}', String(o?.count ?? '')),
  }),
}));
vi.mock('../usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: vi.fn(async () => ({ ok: true })), publishing: false }),
}));
vi.mock('../DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { DraftPreviewBar } from '../DraftPreviewBar';
import { draftPreviewPath, draftSurfaceOf, draftsOnSurface } from '../draftSurface';

afterEach(() => {
  previewState.on = true;
  vi.restoreAllMocks();
});

describe('draftPreviewPath — the deep-link table (objectui#12968)', () => {
  it.each([
    ['a page draft → that page', [{ type: 'page', name: 'crm_home' }], '/apps/app.crm/page/crm_home?preview=draft'],
    [
      'a view draft → the object list on that view',
      [{ type: 'view', name: 'crm_account.pipeline' }],
      '/apps/app.crm/crm_account/view/crm_account.pipeline?preview=draft',
    ],
    [
      'a field draft → the object default list',
      [{ type: 'field', name: 'crm_account.priority' }],
      '/apps/app.crm/crm_account?preview=draft',
    ],
    ['an object draft → the object default list', [{ type: 'object', name: 'crm_account' }], '/apps/app.crm/crm_account?preview=draft'],
    ['an app draft → the app, as the Live Canvas opens it', [{ type: 'app', name: 'crm' }], '/apps/app.crm?preview=draft'],
    ['a draft with no surface of its own → the app', [{ type: 'flow', name: 'crm_onboard' }], '/apps/app.crm?preview=draft'],
    [
      'a batch → its most specific surface',
      [
        { type: 'object', name: 'crm_account' },
        { type: 'view', name: 'crm_account.pipeline' },
      ],
      '/apps/app.crm/crm_account/view/crm_account.pipeline?preview=draft',
    ],
  ])('%s', (_label, items, expected) => {
    expect(draftPreviewPath(items, 'app.crm')).toBe(expected);
  });
});

describe('draftsOnSurface — what the bar counts (objectui#12968)', () => {
  const entries = [
    { type: 'object', name: 'crm_account' },
    { type: 'view', name: 'crm_account.pipeline' },
    { type: 'field', name: 'crm_account.priority' },
    { type: 'object', name: 'crm_contact' },
    { type: 'page', name: 'crm_home' },
    { type: 'flow', name: 'crm_onboard' },
  ];
  it.each([
    ['an object list', 'crm_account', ['crm_account', 'crm_account.pipeline', 'crm_account.priority']],
    ['a view of the object', 'crm_account/view/crm_account.pipeline', ['crm_account', 'crm_account.pipeline', 'crm_account.priority']],
    ['a record of the object', 'crm_contact/record/r1', ['crm_contact']],
    ['a page', 'page/crm_home', ['crm_home']],
  ])('%s', (_label, subPath, names) => {
    const surface = draftSurfaceOf(subPath);
    expect(surface).not.toBeNull();
    expect(draftsOnSurface(entries, surface!).map((e) => e.name)).toEqual(names);
  });
  it('the app landing and admin routes show no single surface', () => {
    expect(draftSurfaceOf('')).toBeNull();
    expect(draftSurfaceOf('metadata/object')).toBeNull();
    expect(draftSurfaceOf('search')).toBeNull();
  });
});

function mockDrafts(list: unknown) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => list })) as unknown as typeof fetch;
}

function renderBarAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apps/:appName/*" element={<DraftPreviewBar />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PENDING = [
  { type: 'object', name: 'crm_account', packageId: 'app.crm' },
  { type: 'view', name: 'crm_account.pipeline', packageId: 'app.crm' },
  { type: 'page', name: 'crm_home', packageId: 'app.crm' },
];

describe('the DraftPreviewBar pending line (objectui#12968)', () => {
  it('on an object list it names the drafts pending on that object', async () => {
    mockDrafts(PENDING);
    renderBarAt('/apps/app.crm/crm_account?preview=draft');
    await waitFor(() =>
      expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent('Draft preview · 2 unpublished changes on this page'),
    );
    // The package-wide count stays on Changes, as before.
    expect(screen.getByTestId('draft-preview-changes')).toHaveTextContent('(3)');
  });

  it('on a page it names the drafts pending on that page', async () => {
    mockDrafts(PENDING);
    renderBarAt('/apps/app.crm/page/crm_home?preview=draft');
    await waitFor(() =>
      expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent('Draft preview · 1 unpublished changes on this page'),
    );
  });

  it('CONTROL: a surface with nothing pending of its own keeps the general message', async () => {
    mockDrafts(PENDING);
    renderBarAt('/apps/app.crm/crm_contact?preview=draft');
    await waitFor(() =>
      expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent(/Nothing here is live until you publish/),
    );
    expect(screen.getByTestId('draft-preview-bar')).not.toHaveTextContent(/on this page/);
  });

  it('CONTROL: the app landing keeps the general message', async () => {
    mockDrafts(PENDING);
    renderBarAt('/apps/app.crm?preview=draft');
    await waitFor(() => expect(screen.getByTestId('draft-preview-changes')).toHaveTextContent('(3)'));
    expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent(/Nothing here is live until you publish/);
  });

  it('CONTROL: outside draft preview the bar draws nothing and reads nothing', () => {
    previewState.on = false;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    renderBarAt('/apps/app.crm/crm_account');
    expect(screen.queryByTestId('draft-preview-bar')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

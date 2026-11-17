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
 *  (b) objectstack#34610 — the DraftPreviewBar counts ONE scope, the current
 *      app's package, on every page of the app: its line, its Changes (N) and
 *      the app's drafts agree — its package and its ADR-0146 customization
 *      pair, off the env-wide `_drafts` (the per-page line is gone);
 *  (c) CONTROL: outside draft preview the bar draws nothing.
 */
import '@testing-library/jest-dom/vitest';
// The draft bar reaches `import('@objectstack/lint')` (its publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
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
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', _packageId: 'app.crm' }] }),
}));

import { DraftPreviewBar } from '../DraftPreviewBar';
import { draftPreviewPath } from '../draftSurface';

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
  // A code-shipped app's edits are drafted into its pair (ADR-0146).
  { type: 'page', name: 'crm_home', packageId: 'app.crm.custom' },
  // Another app's draft in the same environment, and a package-less one: not this app's.
  { type: 'object', name: 'other_note', packageId: 'app.other' },
  { type: 'flow', name: 'loose_flow', packageId: null },
];

describe('the DraftPreviewBar counts the app, on every page (objectstack#34610)', () => {
  it.each([
    ['an object list', '/apps/app.crm/crm_account?preview=draft'],
    ['a page', '/apps/app.crm/page/crm_home?preview=draft'],
    ['the app landing', '/apps/app.crm?preview=draft'],
    ['the app routed by its name', '/apps/crm/crm_contact?preview=draft'],
  ])('on %s: one number in the line and on Changes, read in the app package', async (_label, path) => {
    mockDrafts(PENDING);
    renderBarAt(path);
    await waitFor(() =>
      expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent(
        'Draft preview · 3 unpublished changes in this app.',
      ),
    );
    expect(screen.getByTestId('draft-preview-changes')).toHaveTextContent('(3)');
    expect(screen.getByTestId('draft-preview-bar')).not.toHaveTextContent(/on this page/);
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/meta/_drafts', expect.anything());
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

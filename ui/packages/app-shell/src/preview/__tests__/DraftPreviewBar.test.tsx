/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// In preview mode regardless of the URL plumbing — we are testing the bar's
// own count logic, not the query-flag reader.
vi.mock('../PreviewModeContext', () => ({
  usePreviewDrafts: () => true,
  markPreviewExit: vi.fn(),
  PREVIEW_QUERY_FLAG: 'preview',
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));
vi.mock('../usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: vi.fn(async () => ({ ok: true })), publishing: false }),
}));
vi.mock('../DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { DraftPreviewBar } from '../DraftPreviewBar';

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/app/x?preview=draft']}>
      <DraftPreviewBar />
    </MemoryRouter>,
  );
}

function mockDrafts(list: unknown) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => list })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DraftPreviewBar', () => {
  it('drops the redundant Publish affordance when there are zero pending drafts (auto-publish norm)', async () => {
    mockDrafts([]);
    renderBar();
    // The bar is always the preview-mode indicator…
    expect(screen.getByTestId('draft-preview-bar')).toBeInTheDocument();
    // …but once we KNOW the count is zero, Publish + Changes go away and the
    // copy stops claiming nothing is live.
    await waitFor(() => {
      expect(screen.queryByTestId('draft-preview-publish')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('draft-preview-changes')).not.toBeInTheDocument();
    // The empty-data magic-moment hint is pending-only too: nothing is staged,
    // so there is no "publish to load sample data" to promise.
    expect(screen.queryByTestId('draft-preview-sample-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent(/no unpublished changes/i);
    expect(screen.getByTestId('draft-preview-exit')).toBeInTheDocument();
  });

  it('keeps Publish + the warning message + Changes(N) when drafts are genuinely pending', async () => {
    mockDrafts([{ type: 'object', name: 'a' }, { type: 'object', name: 'b' }]);
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId('draft-preview-publish')).toBeInTheDocument();
    });
    expect(screen.getByTestId('draft-preview-changes')).toHaveTextContent('(2)');
    expect(screen.getByTestId('draft-preview-bar')).toHaveTextContent(/Nothing here is live until you publish/i);
  });

  it('explains the empty preview and elevates Publish to the dominant CTA when a seed draft is pending', async () => {
    mockDrafts([{ type: 'object', name: 'a' }, { type: 'seed', name: 'a' }]);
    renderBar();
    // The magic-moment hint names WHY the preview looks empty (the pending
    // seed's rows load on publish), so a hollow-looking draft never reads as a
    // broken build…
    const hint = await screen.findByTestId('draft-preview-sample-hint');
    expect(hint).toHaveTextContent(/sample data appears once you publish/i);
    // …and the Publish button is the prominent, action-oriented next step.
    expect(screen.getByTestId('draft-preview-publish')).toHaveTextContent(/publish to see it live/i);
  });

  // objectui#13140 — publishing loads rows only for a pending `seed` draft, so
  // a pending change in a package with no sample data (its records already
  // show) must not promise sample data on publish.
  it('offers Publish without the sample-data hint when no seed draft is pending (objectui#13140)', async () => {
    mockDrafts([{ type: 'view', name: 'account.kanban' }]);
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId('draft-preview-publish')).toBeInTheDocument();
    });
    expect(screen.getByTestId('draft-preview-publish')).toHaveTextContent(/publish to see it live/i);
    expect(screen.queryByTestId('draft-preview-sample-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-preview-bar')).not.toHaveTextContent(/sample data|example records/i);
  });

  it('keeps Publish visible but promises no sample data when the draft count is unknown (fetch failed) — only a known zero relaxes', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => null })) as unknown as typeof fetch;
    renderBar();
    // pendingCount stays null → not known-zero → safe default keeps the publish path.
    await waitFor(() => {
      expect(screen.getByTestId('draft-preview-publish')).toBeInTheDocument();
    });
    // objectui#13140 — an unknown count read no entries, so nothing says a
    // seed is pending: the sample-data promise is not made.
    expect(screen.queryByTestId('draft-preview-sample-hint')).not.toBeInTheDocument();
  });
});

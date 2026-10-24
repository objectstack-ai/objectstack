/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5694 — the standing unpublished-changes bar. The publish entry
 * point must not depend on where the transcript happens to be scrolled:
 * while the bound package has pending drafts the bar renders, its Publish
 * goes through the governed `publish-drafts` route, and it disappears when
 * the pending count reaches zero.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { PendingDraftsBar } from '../PendingDraftsBar.js';

const refresh = vi.fn();
// objectui#5801 — the bar reads its count from the shared `_drafts` fetch;
// the stub routes by URL: drafts reads answer `draftRows`, publish POSTs 200.
//
// ⚠️ The answers are REAL `Response` objects, and that is load-bearing since
// objectui#10039 routed the publish through `MetadataClient`: the console's
// authenticated fetch reads `response.headers` on every `/api/` call (the
// `set-auth-token` session rotation). A hand-rolled `{ ok, status, json }`
// literal has no `headers`, so it threw inside the wrapper — which the bar
// reports as a failed publish and then skips the bus pulse, leaving this
// file's "then hides" pin failing for a reason that is entirely the fixture's.
let draftRows: Array<Record<string, unknown>> = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

vi.mock('../../../providers/MetadataProvider.js', () => ({
  useMetadata: () => ({ refresh }),
}));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  publishHealthFromResponse: () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  draftRows = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).includes('/meta/_drafts')) {
        return json(draftRows);
      }
      return json({ success: true });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PendingDraftsBar (objectui#5694)', () => {
  it('renders nothing when the package has no pending drafts, and nothing when unbound', async () => {
    draftRows = [];
    const { container, rerender } = render(<PendingDraftsBar packageId="app.k9qk" idle />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/meta/_drafts?packageId=app.k9qk',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
    expect(container.querySelector('[data-testid="pending-drafts-bar"]')).toBeNull();
    rerender(<PendingDraftsBar packageId={undefined} idle />);
    expect(container.querySelector('[data-testid="pending-drafts-bar"]')).toBeNull();
  });

  it('shows the count while drafts are pending, publishes through publish-drafts, then hides', async () => {
    // One pending dashboard draft (the cloud#1584 shape) until published.
    draftRows = [{ type: 'dashboard', name: 'task_dashboard', packageId: 'app.k9qk' }];
    const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle />);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="pending-drafts-bar"]')).toBeTruthy(),
    );

    // Publishing empties the pending set on the post-publish refetch (the
    // bus pulse the publish emits drives it through the shared hook).
    draftRows = [];
    const bar = container.querySelector('[data-testid="pending-drafts-bar"]') as HTMLElement;
    const button = bar.querySelector('button');
    if (!button) throw new Error('no button. bar html: ' + bar.outerHTML.slice(0, 500));
    fireEvent.click(button);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/packages/app.k9qk/publish-drafts',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="pending-drafts-bar"]')).toBeNull(),
    );
    expect(refresh).toHaveBeenCalled();
  });
});

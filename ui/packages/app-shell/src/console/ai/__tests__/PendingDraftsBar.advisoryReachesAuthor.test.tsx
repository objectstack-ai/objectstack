/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10039 — a per-draft advisory the SERVER sent must reach the author
 * on THIS surface, the AI build pane's standing unpublished-changes bar.
 *
 * ## What this asserts, and what would be worthless
 *
 * The defect is not "the wrong function was called" — it is that the findings
 * VANISH. So this drives the bar's own Publish button, answers it with the
 * batch body the framework's runtime authoring gate actually sends (the
 * advisories riding each `published[]` element, objectstack#9343), and asserts
 * the finding's own prose arrives at the console's advisory sink. A pin that
 * only watched for `publishPackageDrafts` being called would pass over a seam
 * that reported nothing.
 *
 * ## Real vs stubbed
 *
 * Real: the bar, `useMetadataClient` (⛔ deliberately NOT mocked — it is the
 * hook that hands the toast sink to the client factory, so mocking it is
 * exactly how this whole class of hole stayed invisible; see the module doc of
 * `views/metadata-admin/useMetadataClient.advisorySink.test.tsx`), the
 * authenticated fetch wrapper, `MetadataClient`, its `published[]` walk,
 * `readSaveAdvisories` and `emitSaveAdvisories`.
 *
 * Stubbed, and only these: `sonner` (the terminal sink, imported as a module
 * binding so it cannot be handed over), `globalThis.fetch` (the server) and
 * `MetadataProvider` (the bar's unrelated `refresh` dependency).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock('../../../providers/MetadataProvider.js', () => ({
  useMetadata: () => ({ refresh: vi.fn() }),
}));

import { toast } from 'sonner';
import { PendingDraftsBar } from '../PendingDraftsBar.js';

/**
 * One finding in the gate's D3 shape. All six keys are required —
 * `readSaveAdvisories` drops a half-shaped finding, so a fixture missing one
 * would make this file pass (or fail) for the wrong reason.
 */
const PURGE_ADVISORY = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/**
 * The batch body, in the envelope `PublishPackageDraftsResponseSchema` declares
 * for this route: the dispatcher's `{ success, data }`, with `advisories`
 * riding the `published[]` element rather than a parallel top-level map.
 */
const ADVISED_BATCH = {
  success: true,
  data: {
    outcome: 'published',
    publishedCount: 1,
    failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_purge', advisories: [PURGE_ADVISORY] }],
    failed: [],
  },
};

/** The same publish, clean: the server omits `advisories` entirely. */
const CLEAN_BATCH = {
  success: true,
  data: {
    outcome: 'published',
    publishedCount: 1,
    failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_purge' }],
    failed: [],
  },
};

let draftRows: Array<Record<string, unknown>> = [];
let batchBody: unknown = ADVISED_BATCH;
let publishPosts = 0;

beforeEach(() => {
  vi.clearAllMocks();
  draftRows = [{ type: 'flow', name: 'nightly_purge', packageId: 'app.k9qk' }];
  batchBody = ADVISED_BATCH;
  publishPosts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).includes('/meta/_drafts')) {
        return new Response(JSON.stringify(draftRows), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/publish-drafts')) {
        publishPosts += 1;
        return new Response(JSON.stringify(batchBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the bar and press its Publish. */
async function publishFromTheBar(): Promise<void> {
  const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle />);
  await waitFor(() =>
    expect(container.querySelector('[data-testid="pending-drafts-bar"]')).toBeTruthy(),
  );
  const button = container.querySelector('[data-testid="pending-drafts-bar"] button');
  if (!button) throw new Error('the bar rendered without its Publish button');
  // The post-publish refetch empties the pending set, as the server would.
  draftRows = [];
  fireEvent.click(button);
  await waitFor(() => expect(publishPosts).toBe(1));
}

describe('PendingDraftsBar — the server’s advisory reaches the author (objectui#10039)', () => {
  it('renders the finding the batch publish answered with', async () => {
    await publishFromTheBar();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [title, options] = vi.mocked(toast.warning).mock.calls[0] as [
      string,
      { description?: string } | undefined,
    ];
    // The door discriminator survived the seam — a publish says "Published".
    expect(title).toMatch(/^Published\b/);
    // The finding itself arrived, not merely "something was toasted".
    expect(options?.description).toContain(PURGE_ADVISORY.message);
    expect(options?.description).toContain(PURGE_ADVISORY.rule);
    expect(options?.description).toContain(PURGE_ADVISORY.hint);
  });

  it('CONTROL: a clean publish says nothing, and the same drive really ran', async () => {
    batchBody = CLEAN_BATCH;
    await publishFromTheBar();

    // The zero is a reading only beside a control that MUST hit: the publish
    // travelled the whole chain, so the silence is about an empty advisory
    // list and not about a chain that never ran.
    expect(publishPosts).toBe(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11922 — Home's *Publish all* and the draft-preview bar name each
 * refused item with the server's reason.
 *
 * ## The defect
 *
 * Both surfaces publish through `usePublishAllDrafts`, which sends each
 * package's drafts to `POST /packages/:id/publish-drafts`. A refusal answers
 * on a 200 with the batch's own `success: false` AND `failed[]`, where every
 * item that did not publish carries its `error`
 * (`PublishPackageDraftsResponseSchema`). The hook asked `success` first and
 * threw "publish-drafts did not publish this package" — the batch carries no
 * `error` key — so the toast named no item and no reason.
 *
 * ## Real vs stubbed
 *
 * Real: the hook, `useMetadataClient` and the client it builds (which unwraps
 * the batch route's `{ success, data }` envelope), the publish-health reader.
 * Stubbed: `sonner` (the terminal sink the hook imports directly) and
 * `globalThis.fetch` (the server). The drafts are a `view` and a `flow`, types
 * the capability lint does not read, so no lint request is in the way.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { TranslateFn } from '@object-ui/i18n';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { usePublishAllDrafts } from '../usePublishAllDrafts';

const PKG_ID = 'com.acme.crm';

/** Answers the KEY (and its count), so a toast is told by its row, never by prose. */
const t: TranslateFn = (key, options) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

/** A batch answer as the producer sends it, inside the dispatcher's envelope. */
function batch(data: Record<string, unknown>) {
  return { success: true, data: { success: data.outcome === 'published', ...data } };
}

let batchBody: unknown;
/** Every publish request the hook sent: the batch door and the by-reference one. */
const posts: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/publish-drafts')) {
        posts.push(url);
        return json(batchBody);
      }
      if (/\/meta\/flow\/[^/]+\/publish$/.test(url)) {
        posts.push(url);
        return json({ success: true });
      }
      if (url.includes('/meta/_drafts')) {
        return json({
          drafts: [
            { type: 'view', name: 'lead_list', packageId: PKG_ID },
            { type: 'flow', name: 'nightly_digest', packageId: null },
          ],
        });
      }
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function publishAll() {
  const { result } = renderHook(() => usePublishAllDrafts(t));
  let outcome: Awaited<ReturnType<typeof result.current.publishAll>> | undefined;
  await act(async () => {
    outcome = await result.current.publishAll();
  });
  return outcome;
}

const calls = (fn: unknown) => vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls.map((c) => c[0]);

describe('Publish all names what a refused package publish refused (objectui#11922)', () => {
  it('a refused batch toasts each refused item with the server’s reason', async () => {
    const reason = 'sharingModel is not set';
    const stored = "Draft 'views/lead_list' is stored under the non-canonical metadata type 'views'";
    batchBody = batch({
      outcome: 'refused',
      publishedCount: 0,
      failedCount: 2,
      published: [],
      failed: [
        { type: 'object', name: 'lead', error: reason, code: 'SECURITY_OWD_UNSET' },
        { type: 'views', name: 'lead_list', error: stored, code: 'STORED_TYPE_NOT_CANONICAL' },
      ],
    });
    const outcome = await publishAll();
    expect(outcome?.ok).toBe(false);
    const errors = calls(toast.error);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^home\.pendingDrafts\.publishFailed: /);
    expect(errors[0]).toContain(`object/lead: ${reason}`);
    expect(errors[0]).toContain(`views/lead_list: ${stored}`);
    expect(errors[0]).not.toContain('publish-drafts did not publish this package');
    expect(calls(toast.success)).toEqual([]);
  });

  it('a rolled-back batch names its causal item, and not the siblings it took down', async () => {
    const reason = 'sharingModel is not set';
    batchBody = batch({
      outcome: 'refused',
      publishedCount: 0,
      failedCount: 2,
      published: [],
      failed: [
        {
          type: 'view',
          name: 'lead_list',
          error: 'not published — the batch is all-or-nothing (ADR-0067 D2) and object/lead failed; the transaction rolled back',
          code: 'BATCH_ABORTED',
        },
        { type: 'object', name: 'lead', error: reason, code: 'SECURITY_OWD_UNSET' },
      ],
    });
    await publishAll();
    const errors = calls(toast.error);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`object/lead: ${reason}`);
    expect(errors[0]).not.toContain('view/lead_list');
  });
});

describe('control: a published batch reads as before (objectui#11922)', () => {
  it('records the batch’s health and goes on to the package-less drafts', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'view', name: 'lead_list', version: 'sha256:0' }],
      failed: [],
      seedApplied: { success: true, inserted: 3, updated: 0 },
    });
    const outcome = await publishAll();
    expect(outcome).toEqual({ ok: true, attempted: 2 });
    // The orphan flow went out by reference after the batch.
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatch(/\/publish-drafts$/);
    expect(posts[1]).toMatch(/\/meta\/flow\/nightly_digest\/publish$/);
    // The health was recorded: the seeded-rows row, with the batch's 3.
    expect(calls(toast.success)).toEqual(['home.pendingDrafts.publishedVerified:3']);
    expect(calls(toast.error)).toEqual([]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12402 — *Publish all* publishes each bundle member of a
 * package-less draft by its own `?member=`.
 *
 * ## The defect
 *
 * `GET /meta/_drafts` serves `member` on each draft of a type whose identity
 * is a pair (today `email_template`, `(name, locale)`). Two languages of one
 * template drafted outside a package are two rows with one `type` and `name`.
 * The hook mapped each row to `{ type, name, packageId }`, dropping `member`,
 * and published package-less rows by type and name only — so the by-name door
 * promoted the canonical member twice and the other language never.
 *
 * ## Real vs stubbed
 *
 * Real: the hook, `useMetadataClient` and the `MetadataClient` it builds.
 * Stubbed: `sonner` (the terminal sink) and `globalThis.fetch` (the server).
 * The drafts are `email_template` and `flow`, types the capability lint does
 * not read, so no lint request is in the way.
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

const t: TranslateFn = (key, options) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

let drafts: unknown[] = [];
/** Every publish request the hook sent, in order. */
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
        return json({
          success: true,
          data: { success: true, outcome: 'published', publishedCount: 1, failedCount: 0, published: [], failed: [] },
        });
      }
      if (/\/publish(\?|$)/.test(url)) {
        posts.push(url);
        return json({ success: true, version: 'sha256:0', seq: 1, message: 'ok' });
      }
      if (url.includes('/meta/_drafts')) return json({ drafts });
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

/** The path and query of a publish URL, without the origin and API base. */
const tail = (url: string) => url.slice(url.indexOf('/meta/') >= 0 ? url.indexOf('/meta/') : url.indexOf('/packages/'));

describe('Publish all addresses each bundle member of a package-less draft (objectui#12402)', () => {
  it('two package-less members of one email_template publish with their own ?member=', async () => {
    drafts = [
      { type: 'email_template', name: 'welcome', member: 'en-US', packageId: null },
      { type: 'email_template', name: 'welcome', member: 'zh-CN', packageId: null },
    ];
    const outcome = await publishAll();

    expect(outcome).toEqual({ ok: true, attempted: 2 });
    expect(posts.map(tail)).toEqual([
      '/meta/email_template/welcome/publish?member=en-US',
      '/meta/email_template/welcome/publish?member=zh-CN',
    ]);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('a member-less draft sends no selector, and an empty member is not sent', async () => {
    drafts = [
      { type: 'flow', name: 'nightly_digest', packageId: null },
      { type: 'email_template', name: 'welcome', member: '', packageId: null },
    ];
    await publishAll();

    expect(posts.map(tail)).toEqual([
      '/meta/flow/nightly_digest/publish',
      '/meta/email_template/welcome/publish',
    ]);
    expect(posts.some((u) => u.includes('member='))).toBe(false);
  });

  it('package-bound drafts are unchanged: one batch publish, no by-name publish', async () => {
    drafts = [
      { type: 'email_template', name: 'welcome', member: 'en-US', packageId: PKG_ID },
      { type: 'email_template', name: 'welcome', member: 'zh-CN', packageId: PKG_ID },
      { type: 'email_template', name: 'reminder', member: 'zh-CN', packageId: null },
    ];
    const outcome = await publishAll();

    expect(outcome).toEqual({ ok: true, attempted: 3 });
    expect(posts.map(tail)).toEqual([
      `/packages/${PKG_ID}/publish-drafts`,
      '/meta/email_template/reminder/publish?member=zh-CN',
    ]);
  });
});

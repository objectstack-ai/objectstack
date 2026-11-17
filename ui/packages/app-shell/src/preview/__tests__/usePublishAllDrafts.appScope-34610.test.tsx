// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34610 — the draft bar's Publish publishes ONE APP's drafts.
 *
 * ## The defect it guards
 *
 * The bar's count, its changes panel and its Publish are scoped to the routed
 * app. A code-shipped (managed) app cannot be edited in its own package: an
 * edit is drafted into its ADR-0146 customization pair, `<base>.custom`, and
 * `GET /meta/_drafts?package=<base>` does not list it. Read live on the CRM
 * example: `?package=com.example.crm` answered `[]` while
 * `?package=com.example.crm.custom` listed the view edit. A publish scoped to
 * the base alone then published nothing.
 *
 * So one app's scope is its package and its pair, read off the env-wide list
 * (the pair may not be installed, and `?package=` refuses one that is not):
 * both are published, and another app's drafts are not.
 *
 * ## Real vs stubbed
 *
 * Real: the hook, `useMetadataClient` and the `MetadataClient` it builds.
 * Stubbed: `sonner` and `globalThis.fetch` (the server). The drafts are of
 * types the capability lint does not read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { TranslateFn } from '@object-ui/i18n';
// Paid during collection: the capability probe this hook reaches loads it lazily.
import '@objectstack/lint';

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

import { usePublishAllDrafts } from '../usePublishAllDrafts';
import { subscribePublishReceipt } from '../../assistant/assistantBus';

const t: TranslateFn = (key, options) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

let drafts: unknown[] = [];
const posts: string[] = [];
const draftReads: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  posts.length = 0;
  draftReads.length = 0;
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
      if (url.includes('/meta/_drafts')) {
        draftReads.push(url.slice(url.indexOf('/meta/')));
        return json({ drafts });
      }
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function publishApp(packageId: string | null) {
  const { result } = renderHook(() => usePublishAllDrafts(t));
  let outcome: Awaited<ReturnType<typeof result.current.publishAll>> | undefined;
  await act(async () => {
    outcome = await result.current.publishAll({ packageId });
  });
  return outcome;
}

const tail = (url: string) => url.slice(url.indexOf('/packages/') >= 0 ? url.indexOf('/packages/') : url.indexOf('/meta/'));

const ENVIRONMENT = [
  { type: 'flow', name: 'crm_followup', packageId: 'com.example.crm' },
  { type: 'view', name: 'crm_opportunity.all', packageId: 'com.example.crm.custom' },
  { type: 'flow', name: 'other_digest', packageId: 'com.example.other' },
  { type: 'flow', name: 'loose_flow', packageId: null },
];

describe("the draft bar publishes one app's drafts: its package and its customization pair (objectstack#34610)", () => {
  it('scoped to the base, it publishes the base and the pair, and nothing of another app', async () => {
    drafts = ENVIRONMENT;
    const outcome = await publishApp('com.example.crm');

    expect(outcome).toEqual({ ok: true, attempted: 2 });
    expect(draftReads).toEqual(['/meta/_drafts']);
    expect(posts.map(tail)).toEqual([
      '/packages/com.example.crm/publish-drafts',
      '/packages/com.example.crm.custom/publish-drafts',
    ]);
  });

  it('scoped to the pair, it is the same app', async () => {
    drafts = ENVIRONMENT;
    const outcome = await publishApp('com.example.crm.custom');

    expect(outcome).toEqual({ ok: true, attempted: 2 });
    expect(posts.map(tail)).toEqual([
      '/packages/com.example.crm/publish-drafts',
      '/packages/com.example.crm.custom/publish-drafts',
    ]);
  });

  it("an app whose only drafts are another app's has nothing to publish", async () => {
    drafts = ENVIRONMENT.filter((d) => d.packageId !== 'com.example.crm' && d.packageId !== 'com.example.crm.custom');
    const outcome = await publishApp('com.example.crm');

    expect(outcome).toEqual({ ok: true, attempted: 0 });
    expect(posts).toEqual([]);
  });

  it('the receipt names the scope it published', async () => {
    drafts = ENVIRONMENT;
    const receipts: Array<string | null> = [];
    const unsubscribe = subscribePublishReceipt((r) => receipts.push(r.packageId));
    await publishApp('com.example.crm');
    unsubscribe();
    expect(receipts).toEqual(['com.example.crm']);
  });

  it('CONTROL: unscoped (Home), every pending draft in the environment is published', async () => {
    drafts = ENVIRONMENT;
    const outcome = await publishApp(null);

    expect(outcome).toEqual({ ok: true, attempted: 4 });
    expect(posts.map(tail)).toEqual([
      '/packages/com.example.crm/publish-drafts',
      '/packages/com.example.crm.custom/publish-drafts',
      '/packages/com.example.other/publish-drafts',
      '/meta/flow/loose_flow/publish',
    ]);
  });
});

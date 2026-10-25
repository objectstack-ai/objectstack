/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The package sheet's *Publish app* announces the publish, as every other
 * publish path does (objectui#13057).
 *
 * `publishDrafts` promotes a package's drafts, views among them, and used to
 * emit no metadata-refresh pulse, so the console kept serving what it had read
 * before the publish: no `MetadataProvider` re-read its types or dropped the
 * adapter's caches. It now emits the pulse Studio's publish-all, Home's and the
 * chat bar's emit. And the read after it asks the server: the adapter's stored
 * published view list is dropped by the console client's package door
 * (`viewListDrop.ts`).
 *
 * Real: the sheet, `useMetadataClient` and its client, the assistant bus, and
 * an `ObjectStackAdapter` behind a fake transport. Stubbed: `globalThis.fetch`
 * (the console client's server), as `PackagesPage.publishRefusal-11922.test.tsx`
 * stubs it.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdapterCtx } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';
import { t, tFormat } from './i18n';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus';

const PKG_ID = 'com.acme.crm';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: 'Acme CRM', version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};
const DRAFTS = [{ type: 'view', name: 'account.mine' }];
const VIEW_URL = '/api/v1/meta/view';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let batchBody: unknown;
const posts: string[] = [];

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/publish-drafts')) {
        posts.push(url);
        return json(batchBody);
      }
      if (url.startsWith('/api/v1/meta/_drafts')) return json({ success: true, data: { drafts: DRAFTS } });
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeAdapter() {
  const calls: string[] = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://publish-pulse.test',
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/discovery')) return json({ success: true, data: {} });
      calls.push(url.pathname);
      return json({ success: true, data: { type: 'view', items: [{ name: 'account.all', object: 'account' }] } });
    }) as typeof fetch,
  });
  return { adapter, viewReads: () => calls.filter((c) => c === VIEW_URL).length };
}

async function publishApp(adapter: ObjectStackAdapter): Promise<number> {
  let pulses = 0;
  const off = subscribeMetadataRefresh(() => {
    pulses += 1;
  });
  try {
    render(
      <AdapterCtx.Provider value={adapter}>
        <MemoryRouter>
          <PackageDetailSheet pkg={PKG} open onOpenChange={vi.fn()} onChanged={vi.fn()} />
        </MemoryRouter>
      </AdapterCtx.Provider>,
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: tFormat('engine.packages.detail.publishApp', 'en', { count: DRAFTS.length }),
      }),
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    await screen.findByText((_, node) => !!node && node.childElementCount === 0 && /\S/.test(node.textContent ?? '') && (
      node.textContent === t('engine.packages.detail.publishDraftsOk', 'en') ||
      (node.textContent ?? '').startsWith(tFormat('engine.packages.detail.publishDraftsPartial', 'en', { published: 0, failed: 1 }))
    ));
    return pulses;
  } finally {
    off();
  }
}

describe('Publish app announces the publish, and the next view read asks again (objectui#13057)', () => {
  it('a published batch emits the metadata-refresh pulse once', async () => {
    batchBody = {
      success: true,
      data: { success: true, outcome: 'published', publishedCount: 1, failedCount: 0, published: DRAFTS, failed: [] },
    };
    const { adapter, viewReads } = makeAdapter();
    await adapter.getClient().meta.getItems('view');
    await adapter.listViews('account');
    expect(viewReads()).toBe(1);

    expect(await publishApp(adapter)).toBe(1);

    await adapter.listViews('account');
    expect(viewReads()).toBe(2);
  });

  it('a batch answered with failed[] still announces it, as Studio\'s publish-all does (a pre-15.1 server published the rest)', async () => {
    batchBody = {
      success: true,
      data: {
        success: false,
        outcome: 'refused',
        publishedCount: 0,
        failedCount: 1,
        published: [],
        failed: [{ type: 'view', name: 'account.mine', error: 'bad', code: 'X' }],
      },
    };
    const { adapter } = makeAdapter();
    expect(await publishApp(adapter)).toBe(1);
  });
});

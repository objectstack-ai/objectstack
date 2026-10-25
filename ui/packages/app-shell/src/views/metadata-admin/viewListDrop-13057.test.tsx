/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every view write of the console's `MetadataClient` drops the adapter's stored
 * published view list (objectui#13057, completing objectui#13044 ruling
 * 6268839381 (b)).
 *
 * The adapter answers `listViews` / `listViewOverrides` from the list it stored
 * for the open. The console's metadata pages (`metadata-admin/**`) and Studio
 * (`studio-design/**`) write views through `MetadataClient`, whose transport the
 * adapter never sees, so `useMetadataClient` drops the list after each write
 * door that can change a published view (`viewListDrop.ts`).
 *
 * Real: `ObjectStackAdapter` (its SDK client and `MetadataCache` included,
 * driven through a fake `fetch`), `useMetadataClient` and the client it builds.
 * Stubbed: the console client's transport (`globalThis.fetch`).
 *
 * The writers are enumerated from the client, not listed by hand: every door of
 * `MetadataClient` that sends a write is one of `ITEM_WRITE_DOORS` /
 * `PACKAGE_WRITE_DOORS`, and every console client comes from the hook. So a new
 * write door, or a page that builds its own client, turns a pin here red
 * instead of writing views silently past the stored list.
 */

import * as React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { MetadataClient, ObjectStackAdapter } from '@object-ui/data-objectstack';
import { useMetadataClient } from './useMetadata';
import { ITEM_WRITE_DOORS, PACKAGE_WRITE_DOORS } from './viewListDrop';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped. */
const mask: (source: string) => string = maskComments;

const VIEW_URL = '/api/v1/meta/view';
const VIEWS = [{ name: 'account.all', object: 'account', viewKind: 'list', label: 'All', config: { type: 'grid' } }];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let seq = 0;

/** A real adapter whose own transport is a fake server that counts by URL. */
function makeAdapter() {
  const calls: string[] = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: `http://view-list-drop-${(seq += 1)}.test`,
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/discovery')) return json(200, { success: true, data: {} });
      calls.push(url.pathname + url.search);
      if (url.pathname === VIEW_URL) return json(200, { success: true, data: { type: 'view', items: structuredClone(VIEWS) } });
      return json(200, { success: true, data: {} });
    }) as typeof fetch,
  });
  return { adapter, viewReads: () => calls.filter((c) => c === VIEW_URL).length };
}

/** The console client, as a page gets it, under `adapter`. */
function consoleClient(adapter: ObjectStackAdapter): MetadataClient {
  let client: MetadataClient | null = null;
  function Probe() {
    client = useMetadataClient();
    return null;
  }
  render(
    <AdapterCtx.Provider value={adapter}>
      <Probe />
    </AdapterCtx.Provider>,
  );
  return client as unknown as MetadataClient;
}

/** What the console client's server answers: every write lands, unless refused. */
let refuse = false;
beforeEach(() => {
  refuse = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      if (refuse) return json(409, { success: false, error: { code: 'CONFLICT', message: 'refused' } });
      const url = String(input);
      if (url.includes('/publish-drafts')) {
        return json(200, { success: true, data: { success: true, outcome: 'published', published: [], failed: [] } });
      }
      return json(200, { success: true, data: { success: true, version: 2 } });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * One write of each class, each addressed to a view (the package-wide door
 * names a package, and a package can carry views).
 */
const VIEW_WRITES: Array<[string, (client: MetadataClient) => Promise<unknown>]> = [
  ['save (draft)', (c) => c.save('view', 'account.mine', { name: 'account.mine', object: 'account' }, { mode: 'draft' })],
  ['save (live)', (c) => c.save('view', 'account.mine', { name: 'account.mine', object: 'account' })],
  ['publish', (c) => c.publish('view', 'account.mine')],
  ['publishDraft', (c) => c.publishDraft('view', 'account.mine')],
  ['reset', (c) => c.reset('view', 'account.mine')],
  ['rollback', (c) => c.rollback('view', 'account.mine', 1)],
  ['publishPackageDrafts', (c) => c.publishPackageDrafts('com.acme.crm')],
];

/** Store the list the way the console's eager read does, and read it once. */
async function settleList(adapter: ObjectStackAdapter, viewReads: () => number) {
  await adapter.getClient().meta.getItems('view');
  await adapter.listViews('account');
  expect(viewReads()).toBe(1);
}

describe('each console view write drops the stored list: the next read asks again (objectui#13057)', () => {
  it.each(VIEW_WRITES)('%s', async (_name, write) => {
    const { adapter, viewReads } = makeAdapter();
    const client = consoleClient(adapter);
    await settleList(adapter, viewReads);
    await write(client);
    await adapter.listViews('account');
    await adapter.listViewOverrides('account');
    // One more read, then served from what it stored.
    expect(viewReads()).toBe(2);
  });

  it('a refused view write drops it too: what landed before it is not known', async () => {
    const { adapter, viewReads } = makeAdapter();
    const client = consoleClient(adapter);
    await settleList(adapter, viewReads);
    refuse = true;
    await expect(client.save('view', 'account.mine', { name: 'account.mine', object: 'account' })).rejects.toMatchObject({
      status: 409,
    });
    await adapter.listViews('account');
    expect(viewReads()).toBe(2);
  });
});

describe('controls (objectui#13057)', () => {
  it('a write of another type keeps the stored list', async () => {
    const { adapter, viewReads } = makeAdapter();
    const client = consoleClient(adapter);
    await settleList(adapter, viewReads);
    await client.save('object', 'lead', { name: 'lead', fields: {} }, { mode: 'draft' });
    await client.reset('flow', 'lead_flow');
    await adapter.listViews('account');
    expect(viewReads()).toBe(1);
  });

  it('a write hands back its own answer, untouched by the drop', async () => {
    const { adapter } = makeAdapter();
    const client = consoleClient(adapter);
    await expect(client.publish('view', 'account.mine')).resolves.toMatchObject({ data: { version: 2 } });
  });

  it('with no adapter in context the writes still land', async () => {
    let client: MetadataClient | null = null;
    function Probe() {
      client = useMetadataClient();
      return null;
    }
    render(<Probe />);
    await expect((client as unknown as MetadataClient).publish('view', 'account.mine')).resolves.toMatchObject({
      data: { version: 2 },
    });
  });
});

describe('the writers are enumerated, so a new one cannot be silent (objectui#13057)', () => {
  it('every MetadataClient door that sends a write is one the console client drops after', () => {
    const proto = MetadataClient.prototype as unknown as Record<string, unknown>;
    const members = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && typeof proto[name] === 'function',
    );
    // Positive control: the write funnel the scan keys on is still there.
    expect(members).toContain('sendWrite');
    const writeDoors = members
      .filter((name) => name !== 'sendWrite')
      .filter((name) => /\bthis\.sendWrite\(/.test(mask(String(proto[name]))))
      .sort();
    expect(writeDoors.length).toBeGreaterThan(0);
    expect(writeDoors).toEqual([...ITEM_WRITE_DOORS, ...PACKAGE_WRITE_DOORS].sort());
  });

  it('every console MetadataClient is built by useMetadataClient (the provider builds a read-only one)', () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const builders: string[] = [];
    for (const entry of readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })) {
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry) || entry.includes('__tests__')) continue;
      const code = mask(readFileSync(path.join(srcRoot, entry), 'utf8'));
      if (/(?<!function\s)\bcreateConsoleMetadataClient\s*\(/.test(code)) builders.push(entry.split(path.sep).join('/'));
    }
    // Positive control: the scan reached the hook.
    expect(builders).toContain('views/metadata-admin/useMetadata.ts');
    // `MetadataProvider`'s draft-preview client only reads.
    expect(builders.sort()).toEqual(['providers/MetadataProvider.tsx', 'views/metadata-admin/useMetadata.ts']);
  });
});

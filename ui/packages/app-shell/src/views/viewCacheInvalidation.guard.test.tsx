// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Publishing a view from the console must not leave the adapter's override map
 * stale (objectui#4373).
 *
 * ## The defect
 *
 * `ObjectStackAdapter` caches two view-shaped reads — `getView` under
 * `view:{object}:{name}`, and `listViewOverrides` under
 * `view-overrides:{object}` — with `MetadataCache`'s default **5-minute** TTL.
 * objectui#4363 made the adapter's own four write paths drop both keys. But the
 * console's real create-a-view flow never calls any of them: `handleViewCreate`
 * writes through the ADR-0034 metadata seam (`createRuntimeMetadata` →
 * `metadataClient.save`), and Publish goes `RuntimeDraftBar` →
 * `publishRuntimeMetadata` → `metadataClient.publish`. Two writers into the same
 * `/meta/view/:name` rows; only one of them invalidated anything.
 *
 * Publish is the sharp end. A create lands an invisible per-item DRAFT, and
 * `listViewOverrides` enumerates PUBLISHED rows — so the map is still honest
 * there. Publish promotes the row into exactly the world the map describes, and
 * nothing dropped the key, so the object page kept applying its pre-publish
 * snapshot for the rest of the TTL.
 *
 * It does not self-heal. `loadViewOverrides` (`ObjectView`) treats a RESOLVED
 * map as authoritative and deliberately does not re-probe per view — that is
 * objectui#3774, and it is correct, since re-probing reinstates the 404 flurry
 * the batch read exists to remove. So the per-view `getView` fallback that would
 * have masked a stale map is by design unreachable, and the stale map is served
 * in full.
 *
 * ## What these cases assert, and why in this shape
 *
 * Against a **real `ObjectStackAdapter` with its real `MetadataCache`**, not a
 * recording stand-in: the claim under test is "the second read is fresh", which
 * is a statement about the cache's behaviour. A test that asserted
 * `invalidate` was *called* with the right strings would restate the fix rather
 * than measure it — and would have been just as green before #4373 if the
 * strings had been restated in app-shell (the restatement this fix exists to
 * remove: the key set lives in `invalidateViewKeys` and nowhere else).
 *
 * `RuntimeDraftBar` is driven through the DOM for the same reason: the seam
 * being called is not the claim, the user's Publish click closing the staleness
 * is.
 *
 * ## Reverse verification (performed when written)
 *
 * Deleting the `invalidateViewCaches(type, name, ctx)` line from
 * `publishRuntimeMetadata` — i.e. restoring the pre-#4373 body — turns the
 * publish cases red with the map still missing `account.mine` and `getItems`
 * still at ONE call, which is precisely the measured defect. Deleting it from
 * `createRuntimeMetadata` reddens the create case the same way. The type
 * discrimination case is the control in the other direction: it stays green
 * either way, because a `report` publish must not touch view keys.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { RuntimeDraftBar } from './RuntimeDraftBar';
import { createRuntimeMetadata, publishRuntimeMetadata } from './runtime-metadata-persistence';

const PUBLISHED_VIEW = {
  name: 'account.all',
  object: 'account',
  viewKind: 'list',
  label: 'All Accounts',
  config: { type: 'grid', data: { object: 'account' } },
};

const NEW_VIEW = {
  name: 'account.mine',
  object: 'account',
  viewKind: 'list',
  label: 'My Accounts',
  config: { type: 'grid', data: { object: 'account' } },
};

/**
 * A real adapter over a fake `client.meta`, with the REAL `MetadataCache` left
 * in place. `published` is the server's row set and the test mutates it to
 * model a publish landing — so "did the map go stale?" is answered by what the
 * second `listViewOverrides` returns, not by inspecting the cache.
 */
function makeAdapter() {
  const published: any[] = [PUBLISHED_VIEW];
  const getItems = vi.fn(async () => ({ items: [...published] }));

  const adapter: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  });
  // Skip the handshake; this suite is about the cache, not the transport.
  adapter.connected = true;
  adapter.connectionState = 'connected';
  adapter.client = {
    meta: {
      getItems,
      saveItem: vi.fn(async () => ({ success: true })),
      deleteItem: vi.fn(async () => ({ deleted: true })),
      getItem: vi.fn(async () => ({ item: PUBLISHED_VIEW })),
    },
  };

  return { adapter: adapter as ObjectStackAdapter, getItems, published };
}

/** The `/meta` draft-publish client the ADR-0034 seam talks to. */
function makeMetadataClient(draftItem: unknown = null) {
  return {
    get: vi.fn().mockResolvedValue(draftItem),
    save: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('objectui#4373 — the console publish flow invalidates the override map', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a Publish click makes the next listViewOverrides read fresh', async () => {
    const { adapter, getItems, published } = makeAdapter();
    const metadataClient = makeMetadataClient({
      type: 'view',
      name: NEW_VIEW.name,
      item: NEW_VIEW,
    });

    // 1. The user is on the object page: the batch override map is read and
    //    cached. `account.mine` is still an invisible draft, so its absence
    //    here is CORRECT — this snapshot is honest at the moment it is taken.
    const before = await adapter.listViewOverrides('account');
    expect(Object.keys(before)).toEqual(['account.all']);
    expect(getItems).toHaveBeenCalledTimes(1);

    // 2. The user clicks Publish in the view config panel's draft bar.
    render(
      <RuntimeDraftBar
        type="view"
        name={NEW_VIEW.name}
        metadataClient={metadataClient}
        dataSource={adapter}
        objectName="account"
      />,
    );
    const publishBtn = await screen.findByTestId('runtime-draft-publish');
    // The server promotes the draft into a published row.
    metadataClient.publish.mockImplementation(async () => {
      published.push(NEW_VIEW);
    });
    fireEvent.click(publishBtn);
    // Wait on the bar clearing its pending-draft state, not on `publish` having
    // been called: `setHasDraft(false)` runs strictly AFTER the seam call in
    // `handlePublish`, so this cannot observe a half-finished publish.
    await waitFor(() =>
      expect(screen.queryByTestId('runtime-draft-bar')).toBeNull(),
    );
    expect(metadataClient.publish).toHaveBeenCalledWith('view', NEW_VIEW.name);

    // 3. The object page re-reads. Before #4373 this was served from the
    //    pre-publish snapshot for the rest of the 5-minute TTL — one call to
    //    the transport, and a map that never learns about the new view.
    const after = await adapter.listViewOverrides('account');
    expect(getItems).toHaveBeenCalledTimes(2);
    expect(Object.keys(after).sort()).toEqual(['account.all', 'account.mine']);
  });

  it('publish also drops the per-view getView key', async () => {
    // The other half of the pair. `getView` is the read a per-view probe would
    // use, and an upsert-shaped publish can change a row it already holds.
    const { adapter } = makeAdapter();
    const metadataClient = makeMetadataClient({ item: NEW_VIEW });

    await adapter.getView('account', NEW_VIEW.name);
    expect(adapter.getCached(`view:account:${NEW_VIEW.name}`)).toBeTruthy();

    await publishRuntimeMetadata('view', NEW_VIEW.name, {
      metadataClient,
      dataSource: adapter,
      objectName: 'account',
    });

    expect(adapter.getCached(`view:account:${NEW_VIEW.name}`)).toBeUndefined();
  });

  it('creating a view drops the same keys — the other door into these rows', async () => {
    // `handleViewCreate` / `ObjectDataPage`'s "Save as view". A create lands a
    // DRAFT, so neither cached reader is genuinely staled by it — this is the
    // seam's uniform per-write rule applied on purpose, matching the adapter's
    // own draft half (objectui#4363). An unnecessary invalidation costs one
    // refetch; a per-function exception list is how this key set got forgotten
    // twice already.
    const { adapter, getItems } = makeAdapter();
    const metadataClient = makeMetadataClient();

    await adapter.listViewOverrides('account');
    expect(getItems).toHaveBeenCalledTimes(1);

    await createRuntimeMetadata('view', NEW_VIEW.name, NEW_VIEW, {
      metadataClient,
      dataSource: adapter,
      objectName: 'account',
    });

    await adapter.listViewOverrides('account');
    expect(getItems).toHaveBeenCalledTimes(2);
  });

  it('a report publish touches no view key — the type guard is real', async () => {
    // The control in the opposite direction. `RuntimeDraftBar` is shared with
    // ReportConfigPanel, and over-invalidating there would be a silent cost on
    // an unrelated surface.
    const { adapter, getItems } = makeAdapter();
    const metadataClient = makeMetadataClient();

    await adapter.listViewOverrides('account');
    expect(getItems).toHaveBeenCalledTimes(1);

    await publishRuntimeMetadata('report', 'pipeline', {
      metadataClient,
      dataSource: adapter,
      objectName: 'account',
    });

    await adapter.listViewOverrides('account');
    // Still served from cache: one transport call, not two.
    expect(getItems).toHaveBeenCalledTimes(1);
  });

  it('a call site with no adapter still persists — invalidation is additive', async () => {
    // Every seam caller kept working without passing a `dataSource`, which is
    // what lets `ReportView` and the record-page paths stay untouched.
    const metadataClient = makeMetadataClient();

    await expect(
      publishRuntimeMetadata('view', NEW_VIEW.name, { metadataClient }),
    ).resolves.toBeUndefined();
    expect(metadataClient.publish).toHaveBeenCalledWith('view', NEW_VIEW.name);
  });

  it('an invalidation failure does not fail the publish that succeeded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadataClient = makeMetadataClient();
    const exploding = {
      invalidateViewKeys: () => {
        throw new Error('cache exploded');
      },
    };

    await expect(
      publishRuntimeMetadata('view', NEW_VIEW.name, {
        metadataClient,
        dataSource: exploding,
        objectName: 'account',
      }),
    ).resolves.toBeUndefined();

    expect(metadataClient.publish).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('without an object name nothing object-scoped is named', async () => {
    // Both keys are object-scoped, and `name` is NOT a path to split: a
    // runtime-created view is `<object>.<key>` but a source-declared one is
    // not, so deriving the object from the name would be a second, silently
    // wrong identity rule (AGENTS.md #0.1).
    const metadataClient = makeMetadataClient();
    const invalidateViewKeys = vi.fn();

    await publishRuntimeMetadata('view', 'account.mine', {
      metadataClient,
      dataSource: { invalidateViewKeys },
    });

    expect(metadataClient.publish).toHaveBeenCalled();
    expect(invalidateViewKeys).not.toHaveBeenCalled();
  });
});

/**
 * The structural half: app-shell routes through the seam and never restates the
 * key set. A behavioural test cannot see the difference between "calls the
 * seam" and "spells the same two strings inline", and an inline copy here is
 * exactly the recurrence #4373 was filed about.
 */
describe('objectui#4373 — app-shell never spells a view cache key', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = walk(srcRoot);

  it('is reading the real tree, not an empty one', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('no app-shell file interpolates `view:` or `view-overrides:` as a cache key', () => {
    // Code occurrences only — the `${` marker excludes the prose form
    // (`view-overrides:{object}`) these files legitimately use to EXPLAIN the
    // adapter's keys. Which keys they are is `invalidateViewKeys`' business.
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /`view:\$\{/.test(src) || /`view-overrides:\$\{/.test(src);
    });

    expect(offenders.map((f) => path.relative(srcRoot, f))).toEqual([]);
  });
});

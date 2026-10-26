/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One page open asks the server for one metadata URL once (objectui#13044).
 *
 * `MetadataProvider` and the adapter's `MetadataCache` used to fetch the same
 * URL each on its own: `GET /meta/object/NAME` once for the page's object scope
 * and once more for `getObjectSchema`, and `GET /meta/view` once for the
 * provider's eager `view` read and once each for `listViews` and
 * `listViewOverrides`. These pins drive a REAL `ObjectStackAdapter` (its SDK
 * client included) through a fake `fetch` and count the requests by URL:
 *
 *   (a) the provider's by-name object read and `getObjectSchema` ask
 *       `/meta/object/NAME` once, in either order;
 *   (b) the eager view read, `listViews` and `listViewOverrides` share a
 *       `/meta/view` request that is in flight, and (objectui#13057) the
 *       adapter's two readers read the list the eager read stored: the console
 *       order costs ONE request where it cost three, then two;
 *   (c) the controls: an invalidation still refetches, a provider re-read and
 *       a view write still ask again, the stored list is dropped by every
 *       write and refresh path (the console's own drops are pinned in
 *       `viewListDrop-13057.test.tsx` and
 *       `ObjectView.refreshRereadsViews-13057.test.tsx`), the preview path
 *       still goes to the preview client and never fills the stored list, and
 *       each side's readers see the shape they saw before.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { readObjectSortability } from '@object-ui/core';
import { useMetadata } from '@object-ui/react';
import { MetadataProvider } from '../MetadataProvider';
import { PreviewModeProvider } from '../../preview/PreviewModeContext';

type Ctx = ReturnType<typeof useMetadata>;

const OBJECTS: Record<string, Record<string, unknown>> = {
  sys_member: {
    name: 'sys_member',
    fields: {
      // A legacy spelling: both paths fold it onto `reference` (objectui#7650).
      user: { type: 'lookup', reference_to: 'sys_user' },
      role: { type: 'text' },
    },
  },
  sys_user: { name: 'sys_user', fields: { name: { type: 'text' } } },
};
const VIEWS = [
  { name: 'account.all', object: 'account', viewKind: 'list', label: 'All', config: { type: 'grid', columns: ['name'] } },
  { name: 'account.mine', object: 'account', viewKind: 'list', label: 'Mine', config: { type: 'grid', columns: ['name'] } },
];
const SORTABILITY = { fields: { role: { sortable: true }, user: { sortable: false } } };

interface Server {
  /** Every request but discovery, as `path?query`. */
  calls: string[];
  /** Holds every answer to a URL in this set until `release` is called. */
  hold: Set<string>;
  release: () => void;
  /** Answer `/meta/object/NAME` for these names with a 404 carrying this code (or none). */
  absent: Map<string, string | undefined>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let seq = 0;

function makeServer(): { server: Server; adapter: ObjectStackAdapter } {
  const held: Array<() => void> = [];
  const server: Server = {
    calls: [],
    hold: new Set(),
    release: () => held.splice(0).forEach((go) => go()),
    absent: new Map(),
  };
  const answer = (path: string): Response => {
    if (path.endsWith('/api/v1/discovery')) return json(200, { success: true, data: {} });
    if (path === '/api/v1/meta/view') return json(200, { success: true, data: { type: 'view', items: structuredClone(VIEWS) } });
    if (path === '/api/v1/meta/view?preview=draft') return json(200, { success: true, data: { type: 'view', items: [] } });
    if (path.startsWith('/api/v1/meta/view/')) return json(200, { success: true });
    const byName = /^\/api\/v1\/meta\/object\/([^/?]+)$/.exec(path);
    if (byName) {
      const name = decodeURIComponent(byName[1]);
      if (server.absent.has(name)) {
        const code = server.absent.get(name);
        return json(404, { success: false, error: { message: 'not found', ...(code ? { code } : {}) } });
      }
      return json(200, {
        success: true,
        data: { type: 'object', name, item: structuredClone(OBJECTS[name]), sortability: SORTABILITY },
      });
    }
    const list = /^\/api\/v1\/meta\/([a-z_]+)$/.exec(path);
    if (list) return json(200, { success: true, data: { type: list[1], items: [] } });
    return json(404, { success: false, error: { message: `no route ${path}` } });
  };
  // A fresh origin per server: the adapter shares discovery per base URL.
  const origin = `http://one-read-${(seq += 1)}.test`;
  const adapter = new ObjectStackAdapter({
    baseUrl: origin,
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname + url.search;
      if (!url.pathname.endsWith('/discovery')) server.calls.push(path);
      if (!server.hold.has(path)) return answer(path);
      return new Promise<Response>((resolve) => held.push(() => resolve(answer(path))));
    }) as typeof fetch,
  });
  return { server, adapter };
}

function mount(adapter: ObjectStackAdapter, opts: { preview?: boolean } = {}) {
  let latest: Ctx | null = null;
  function Probe() {
    latest = useMetadata();
    return null;
  }
  const tree = (
    <MetadataProvider adapter={adapter}>
      <Probe />
    </MetadataProvider>
  );
  render(
    opts.preview ? (
      <MemoryRouter>
        <PreviewModeProvider force>{tree}</PreviewModeProvider>
      </MemoryRouter>
    ) : (
      tree
    ),
  );
  return () => latest as unknown as Ctx;
}

const count = (calls: string[], path: string) => calls.filter((c) => c === path).length;
const OBJECT_URL = '/api/v1/meta/object/sys_member';
const VIEW_URL = '/api/v1/meta/view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('one request per object document across both caches (objectui#13044)', () => {
  it('provider first: getObjectSchema reads what the provider asked for', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    await act(async () => {
      await ctx().getItem('object', 'sys_member');
    });
    await adapter.getObjectSchema('sys_member');
    expect(count(server.calls, OBJECT_URL)).toBe(1);
  });

  it('adapter first, still on the wire: the provider joins that request', async () => {
    const { server, adapter } = makeServer();
    server.hold.add(OBJECT_URL);
    const ctx = mount(adapter);
    const fromAdapter = adapter.getObjectSchema('sys_member');
    await waitFor(() => expect(count(server.calls, OBJECT_URL)).toBe(1));
    let fromProvider: Promise<unknown> = Promise.resolve();
    act(() => {
      fromProvider = ctx().getItem('object', 'sys_member');
    });
    server.release();
    await act(async () => {
      await Promise.all([fromAdapter, fromProvider]);
    });
    expect(count(server.calls, OBJECT_URL)).toBe(1);
    expect(await fromProvider).toMatchObject({ name: 'sys_member' });
  });

  it('adapter first, settled: the provider reads the settled answer', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    await adapter.getObjectSchema('sys_member');
    await act(async () => {
      await ctx().getItem('object', 'sys_member');
    });
    expect(count(server.calls, OBJECT_URL)).toBe(1);
  });

  it('the page scope read (readObjectScope names) shares it too', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    act(() => {
      ctx().readObjectScope!({ names: ['sys_member', 'sys_user'] });
    });
    await waitFor(() => expect(ctx().readObjectScope!({ names: ['sys_member', 'sys_user'] }).settled).toBe(true));
    await adapter.getObjectSchema('sys_member');
    await adapter.getObjectSchema('sys_user');
    expect(count(server.calls, OBJECT_URL)).toBe(1);
    expect(count(server.calls, '/api/v1/meta/object/sys_user')).toBe(1);
  });
});

describe('the published view list: one request per open (objectui#13044, objectui#13057)', () => {
  it('console order: the eager read lands, then the object page reads the list and the overrides together', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
    expect(count(server.calls, VIEW_URL)).toBe(1);
    // ObjectView starts both reads in one commit (`listViews` and
    // `loadViewOverrides`), and reads the override map a second time.
    const [views, overrides] = await Promise.all([adapter.listViews('account'), adapter.listViewOverrides('account')]);
    await adapter.listViewOverrides('account');
    expect(views.map((v: any) => v.name).sort()).toEqual(['account.all', 'account.mine']);
    expect(Object.keys(overrides).sort()).toEqual(['account.all', 'account.mine']);
    // Was 3 (one per reader), then 2 (objectui#13044: the page's two readers
    // shared one more request in flight). objectui#13057: the eager read
    // stored its answer, and both readers read it, so the open costs one.
    expect(count(server.calls, VIEW_URL)).toBe(1);
  });

  it('a reader that asks while the eager read is on the wire joins it', async () => {
    const { server, adapter } = makeServer();
    server.hold.add(VIEW_URL);
    const ctx = mount(adapter);
    await waitFor(() => expect(count(server.calls, VIEW_URL)).toBe(1));
    const views = adapter.listViews('account');
    const overrides = adapter.listViewOverrides('account');
    // Both wait on the discovery read first; let them reach the list read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    server.release();
    await act(async () => {
      await Promise.all([views, overrides]);
    });
    await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
    expect(count(server.calls, VIEW_URL)).toBe(1);
  });
});

describe('controls (objectui#13044)', () => {
  it('a provider invalidation still asks the server again, and so does the adapter after it', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    await act(async () => {
      await ctx().getItem('object', 'sys_member');
    });
    act(() => ctx().invalidate('object', 'sys_member'));
    await act(async () => {
      await ctx().getItem('object', 'sys_member');
    });
    expect(count(server.calls, OBJECT_URL)).toBe(2);
    await adapter.getObjectSchema('sys_member');
    expect(count(server.calls, OBJECT_URL)).toBe(2);

    // A refresh of the object type re-reads every scoped name from the server.
    act(() => {
      ctx().readObjectScope!({ names: ['sys_member'] });
    });
    await waitFor(() => expect(ctx().readObjectScope!({ names: ['sys_member'] }).settled).toBe(true));
    await act(async () => {
      await ctx().refresh('object');
    });
    expect(count(server.calls, OBJECT_URL)).toBe(3);
  });

  it('the list is settled within an open, and a provider re-read asks again and is what the next list read sees (objectui#13057)', async () => {
    const { server, adapter } = makeServer();
    const ctx = mount(adapter);
    await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
    await adapter.listViews('account');
    await adapter.listViews('account');
    // Answered from the list the eager read stored.
    expect(count(server.calls, VIEW_URL)).toBe(1);
    // The provider's re-read is a client read: it never reads the stored list.
    await act(async () => {
      await ctx().refresh('view');
    });
    expect(count(server.calls, VIEW_URL)).toBe(2);
    // ...and what it was answered is what the adapter's readers read next.
    VIEWS.push({ name: 'account.new', object: 'account', viewKind: 'list', label: 'New', config: { type: 'grid', columns: ['name'] } });
    try {
      expect((await adapter.listViews('account')).map((v: any) => v.name).sort()).toEqual(['account.all', 'account.mine']);
      expect(count(server.calls, VIEW_URL)).toBe(2);
      await act(async () => {
        await ctx().refresh('view');
      });
      expect((await adapter.listViews('account')).map((v: any) => v.name).sort()).toEqual([
        'account.all',
        'account.mine',
        'account.new',
      ]);
      expect(count(server.calls, VIEW_URL)).toBe(3);
    } finally {
      VIEWS.pop();
    }
  });

  it('a view write drops the stored list: the next list read asks again (objectui#13057)', async () => {
    for (const write of [
      (adapter: ObjectStackAdapter) => adapter.invalidateViewKeys('account', 'account.mine'),
      (adapter: ObjectStackAdapter) =>
        adapter.getClient().meta.saveItem('view', 'account.mine', { name: 'account.mine', object: 'account' }),
    ]) {
      const { server, adapter } = makeServer();
      const ctx = mount(adapter);
      await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
      await adapter.listViews('account');
      expect(count(server.calls, VIEW_URL)).toBe(1);
      await write(adapter);
      await adapter.listViews('account');
      // An object whose override map was never read: derived from the stored list.
      await adapter.listViewOverrides('contact');
      // The read after the write asked; the one after it reads what it stored.
      expect(count(server.calls, VIEW_URL)).toBe(2);
      cleanup();
    }
  });

  it('a view write detaches the list request in flight: a read after it asks again', async () => {
    const { server, adapter } = makeServer();
    server.hold.add(VIEW_URL);
    const ctx = mount(adapter);
    await waitFor(() => expect(count(server.calls, VIEW_URL)).toBe(1));
    // Joins the eager read on the wire (after its own discovery read).
    const before = adapter.listViews('account');
    await new Promise((resolve) => setTimeout(resolve, 0));
    adapter.invalidateViewKeys('account', 'account.mine');
    const after = adapter.listViews('account');
    await waitFor(() => expect(count(server.calls, VIEW_URL)).toBe(2));
    server.release();
    await Promise.all([before, after]);
    await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
  });

  it('a view saved straight through the client detaches the list request in flight too', async () => {
    const { server, adapter } = makeServer();
    server.hold.add(VIEW_URL);
    const ctx = mount(adapter);
    await waitFor(() => expect(count(server.calls, VIEW_URL)).toBe(1));
    const before = adapter.listViews('account');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The shape a page uses when it writes a view without the adapter's seam.
    await adapter.getClient().meta.saveItem('view', 'account.mine', { name: 'account.mine', object: 'account' });
    const after = adapter.listViews('account');
    await waitFor(() => expect(count(server.calls, VIEW_URL)).toBe(2));
    server.release();
    await Promise.all([before, after]);
    await waitFor(() => expect(ctx().getTypeStatus!('view')).toBe('ready'));
  });

  it('a draft-preview list read never fills the stored list (objectui#13057)', async () => {
    const { server, adapter } = makeServer();
    // The adapter's draft-overlaid read is its own request, on its preview client...
    await adapter.listViews('account', { previewDrafts: true });
    expect(count(server.calls, `${VIEW_URL}?preview=draft`)).toBe(1);
    expect(count(server.calls, VIEW_URL)).toBe(0);
    // ...and stores nothing a published read could be answered from.
    expect(adapter.getCached('list:view')).toBeUndefined();
    const published = await adapter.listViews('account');
    expect(published.map((v: any) => v.name).sort()).toEqual(['account.all', 'account.mine']);
    expect(count(server.calls, VIEW_URL)).toBe(1);
  });

  it('the preview path still reads through the preview client, never the adapter', async () => {
    const { server, adapter } = makeServer();
    const preview: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        preview.push(String(input));
        const url = String(input);
        if (url.includes('/meta/object/sys_member')) {
          return json(200, { success: true, data: { type: 'object', name: 'sys_member', item: OBJECTS.sys_member } });
        }
        return json(200, { success: true, data: { type: 'x', items: [] } });
      }),
    );
    const ctx = mount(adapter, { preview: true });
    await act(async () => {
      await ctx().getItem('object', 'sys_member');
    });
    expect(preview.some((u) => u.includes('/meta/object/sys_member') && u.includes('preview=draft'))).toBe(true);
    expect(count(server.calls, OBJECT_URL)).toBe(0);
    expect(adapter.getCached('sys_member')).toBeUndefined();
  });

  it('each side keeps its shape: the provider copy is normalized and carries no sortability', async () => {
    const { adapter } = makeServer();
    const ctx = mount(adapter);
    let fromProvider: any;
    await act(async () => {
      fromProvider = await ctx().getItem('object', 'sys_member');
    });
    const fromAdapter: any = await adapter.getObjectSchema('sys_member');

    // Both folded the legacy spelling onto `reference`.
    expect(fromProvider.fields.user.reference).toBe('sys_user');
    expect(fromAdapter.fields.user.reference).toBe('sys_user');
    // The adapter's readers keep the served sortability projection; the
    // provider's readers never had it and still do not.
    expect(readObjectSortability(fromAdapter)).toEqual(SORTABILITY);
    expect(readObjectSortability(fromProvider)).toBeUndefined();
    // Two copies: a change to one is not seen by the other.
    expect(fromProvider).not.toBe(fromAdapter);
    fromProvider.fields.role.label = 'changed by a provider reader';
    expect(fromAdapter.fields.role.label).toBeUndefined();
  });

  it('an absence is still an answer and a bare 404 is still a failure', async () => {
    const { server, adapter } = makeServer();
    server.absent.set('gone', 'RESOURCE_NOT_FOUND');
    server.absent.set('unknown', undefined);
    const ctx = mount(adapter);
    act(() => {
      ctx().readObjectScope!({ names: ['gone', 'unknown'] });
    });
    await waitFor(() => expect(ctx().readObjectScope!({ names: ['gone'] }).missing).toEqual(['gone']));
    // The code-less 404 obtained no answer: never listed missing, never settled.
    const scope = ctx().readObjectScope!({ names: ['unknown'] });
    expect(scope.missing).not.toContain('unknown');
    expect(server.calls.filter((c) => c === '/api/v1/meta/object/gone')).toHaveLength(1);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An organization or session switch drops the adapter's metadata
 * (objectui#13044, ruling 6268839381).
 *
 * The provider reads object documents through the adapter's `getObjectSchema`,
 * so the adapter's cache now holds what the provider read. A switch inside the
 * SPA must not let one organization's (or one user's) documents, or a request
 * in flight for them, answer a read made in the other. A REAL
 * `ObjectStackAdapter` is driven through a fake `fetch`; only `useAuth` is
 * stubbed, the way `MetadataProvider.orgScopedCache.test.tsx` stubs it.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState: { activeOrganization: { id: string } | null; user: { id: string } | null } = {
  activeOrganization: null,
  user: null,
};
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...actual, useAuth: () => authState };
});

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { useMetadata } from '@object-ui/react';
import { MetadataProvider } from '../MetadataProvider';

type Ctx = ReturnType<typeof useMetadata>;
const OBJECT_URL = '/api/v1/meta/object/sys_member';
const VIEW_URL = '/api/v1/meta/view';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let seq = 0;

function makeServer() {
  const calls: string[] = [];
  const held: Array<() => void> = [];
  const hold = new Set<string>();
  const answer = (path: string): Response => {
    if (path.endsWith('/discovery')) return json({ success: true, data: {} });
    if (path === OBJECT_URL) {
      return json({ success: true, data: { type: 'object', name: 'sys_member', item: { name: 'sys_member', fields: {} } } });
    }
    if (path === VIEW_URL) return json({ success: true, data: { type: 'view', items: [] } });
    return json({ success: true, data: { type: 'x', items: [] } });
  };
  const adapter = new ObjectStackAdapter({
    baseUrl: `http://switch-${(seq += 1)}.test`,
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname + url.search;
      if (!url.pathname.endsWith('/discovery')) calls.push(path);
      if (!hold.has(path)) return answer(path);
      return new Promise<Response>((resolve) => held.push(() => resolve(answer(path))));
    }) as typeof fetch,
  });
  return { adapter, calls, hold, release: () => held.splice(0).forEach((go) => go()) };
}

function mount(adapter: ObjectStackAdapter) {
  let latest: Ctx | null = null;
  function Probe() {
    latest = useMetadata();
    return null;
  }
  const tree = () => (
    <MetadataProvider adapter={adapter}>
      <Probe />
    </MetadataProvider>
  );
  const view = render(tree());
  return { ctx: () => latest as unknown as Ctx, rerender: () => view.rerender(tree()) };
}

const count = (calls: string[], path: string) => calls.filter((c) => c === path).length;

afterEach(() => {
  cleanup();
  authState.activeOrganization = null;
  authState.user = null;
});

describe('a switch drops the adapter metadata the provider read through it (objectui#13044)', () => {
  it('an organization switch: the next object read asks the server, not the old organization\'s entry', async () => {
    const { adapter, calls } = makeServer();
    authState.activeOrganization = { id: 'org_a' };
    const m = mount(adapter);
    await act(async () => {
      await m.ctx().getItem('object', 'sys_member');
    });
    expect(adapter.getCached('sys_member')).toBeDefined();

    authState.activeOrganization = { id: 'org_b' };
    m.rerender();
    await waitFor(() => expect(adapter.getCached('sys_member')).toBeUndefined());
    await adapter.getObjectSchema('sys_member');
    expect(count(calls, OBJECT_URL)).toBe(2);
  });

  it('an organization switch detaches a view-list request in flight', async () => {
    const { adapter, calls, hold, release } = makeServer();
    authState.activeOrganization = { id: 'org_a' };
    hold.add(VIEW_URL);
    const m = mount(adapter);
    await waitFor(() => expect(count(calls, VIEW_URL)).toBe(1));

    authState.activeOrganization = { id: 'org_b' };
    m.rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const views = adapter.listViews('account');
    await waitFor(() => expect(count(calls, VIEW_URL)).toBe(2));
    release();
    await views;
  });

  it('an organization or session switch drops the stored view list: the next list read asks again (objectui#13057)', async () => {
    for (const change of [
      () => {
        authState.activeOrganization = { id: 'org_b' };
      },
      () => {
        authState.user = { id: 'user_b' };
      },
    ]) {
      const { adapter, calls } = makeServer();
      authState.activeOrganization = { id: 'org_a' };
      authState.user = { id: 'user_a' };
      const m = mount(adapter);
      await waitFor(() => expect(count(calls, VIEW_URL)).toBe(1));
      await waitFor(() => expect(m.ctx().getTypeStatus!('view')).toBe('ready'));
      // Settled within the open: the eager read's answer serves the list read.
      await adapter.listViews('account');
      expect(count(calls, VIEW_URL)).toBe(1);

      change();
      m.rerender();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await adapter.listViews('account');
      expect(count(calls, VIEW_URL)).toBe(2);
      cleanup();
      authState.activeOrganization = null;
      authState.user = null;
    }
  });

  it('a session switch (another user) drops it the same way', async () => {
    const { adapter, calls } = makeServer();
    authState.user = { id: 'user_a' };
    const m = mount(adapter);
    await act(async () => {
      await m.ctx().getItem('object', 'sys_member');
    });
    expect(adapter.getCached('sys_member')).toBeDefined();

    authState.user = { id: 'user_b' };
    m.rerender();
    await waitFor(() => expect(adapter.getCached('sys_member')).toBeUndefined());
    await adapter.getObjectSchema('sys_member');
    expect(count(calls, OBJECT_URL)).toBe(2);
  });

  it('CONTROL: the first resolution (unknown to known) is not a switch and keeps the entry', async () => {
    const { adapter } = makeServer();
    const m = mount(adapter);
    await act(async () => {
      await m.ctx().getItem('object', 'sys_member');
    });
    authState.activeOrganization = { id: 'org_a' };
    authState.user = { id: 'user_a' };
    m.rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(adapter.getCached('sys_member')).toBeDefined();
  });
});

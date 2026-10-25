// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12811 — two chrome readers of the object registry read the app's
 * object scope.
 *
 * Measured on HotCRM once the open path's three `objects` readers had moved to
 * the scope: the whole registry (`GET /api/v1/meta/object`) was still asked,
 * from `AppHeader`, through `getItemsByType('object')` in `useServedViewItems`
 * (which view-tab labels the server already translated) and in
 * `useObjectPresence` (whether `sys_activity` exists, for the bell's activity
 * feed). Inside an app whose served item names its package, and while nothing
 * has asked for the whole registry, both now read the app's scope.
 *
 * CONTROL: outside an app (no package) both read the whole registry, as
 * before; and once anything has loaded the whole registry, both read it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { useServedViewItems, isServedView } from '../useServedViewItems';
import { useObjectPresence } from '../useObjectPresence';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, listViews: { 'crm_account.mine': { label: 'Mine', type: 'grid' } } },
  { name: 'sys_activity', _packageId: 'plugin.audit' },
];

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : [];
          const items = options?.packageId ? all.filter((o) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item ? Promise.resolve({ item: structuredClone(item) }) : Promise.reject(new Error('404'));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

type Reading = {
  served: ReturnType<typeof useServedViewItems>;
  presence: ReturnType<typeof useObjectPresence>;
  ctx: ReturnType<typeof useMetadata>;
};

function mount(app: Record<string, unknown>, calls: string[], extra?: ReactNode): () => Reading {
  let latest: Reading | null = null;
  function Probe() {
    latest = { served: useServedViewItems(), presence: useObjectPresence('sys_activity'), ctx: useMetadata() };
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(calls)}>
      <ExpressionProvider app={app}>
        <Probe />
        {extra}
      </ExpressionProvider>
    </MetadataProvider>,
  );
  return () => latest as unknown as Reading;
}

const objectCalls = (calls: string[]) => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));

afterEach(() => cleanup());

describe('the chrome readers of the object registry read the app scope (objectui#12811)', () => {
  it("inside an app with a package: the served documents are the scope's, and presence is asked by name", async () => {
    const calls: string[] = [];
    const read = mount({ name: 'crm', _packageId: CRM }, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    await waitFor(() => expect(isServedView(read().served, 'crm_account', 'crm_account.mine')).toBe(true));

    expect(read().presence.presence).toBe('present');
    expect(objectCalls(calls)).not.toContain('object');
    expect([...objectCalls(calls)].sort()).toEqual([`object?package=${CRM}`, 'object/sys_activity'].sort());
  });

  it('CONTROL: outside an app (no package), both read the whole registry, as before', async () => {
    const calls: string[] = [];
    const read = mount({}, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    expect(read().presence.presence).toBe('present');
    expect(isServedView(read().served, 'crm_account', 'crm_account.mine')).toBe(true);
    expect(objectCalls(calls)).toEqual(['object']);
  });

  it('CONTROL: once the whole registry is loaded, both read it', async () => {
    const calls: string[] = [];
    const read = mount({ name: 'crm', _packageId: CRM }, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    act(() => {
      void read().ctx.objects;
    });
    await waitFor(() => expect(read().ctx.getTypeStatus!('object')).toBe('ready'));
    expect(read().served.objects).toHaveLength(OBJECTS.length);
    expect(read().presence.presence).toBe('present');
  });
});

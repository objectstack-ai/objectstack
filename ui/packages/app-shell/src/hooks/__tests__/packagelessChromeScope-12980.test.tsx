// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — in an app whose served item names NO package (an app
 * created in the console is stored bound to none), two chrome readers of the
 * object registry read the names-only scope instead of the whole registry
 * (`GET /api/v1/meta/object`).
 *
 *  - `useObjectPresence(name)` asks for its one name by name;
 *  - `useServedViewItems()` reads the names-only scope through the app's
 *    `requiresObject` names (the ones `AppContent` asks on a scoped route),
 *    and reads nothing when the app names none.
 *
 * Before, both fell back to `getItemsByType('object')` there, which loads the
 * whole registry on a page route — the one route where such an app reads the
 * names-only scope (`readPageObjectScope`).
 *
 * CONTROL: inside a package app both read the package scope exactly as
 * objectui#12811 left them; outside an app (no app name) both read the whole
 * registry; and once anything has loaded the whole registry, both read it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { useServedViewItems, isServedView } from '../useServedViewItems';
import { useObjectPresence } from '../useObjectPresence';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, listViews: { 'crm_account.mine': { label: 'Mine', type: 'grid' } } },
  { name: 'note', listViews: { 'note.recent': { label: 'Recent', type: 'grid' } } },
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
          return item ? Promise.resolve({ item: structuredClone(item) }) : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
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

function mount(app: Record<string, unknown>, calls: string[], presenceOf = 'sys_activity'): () => Reading {
  let latest: Reading | null = null;
  function Probe() {
    latest = { served: useServedViewItems(), presence: useObjectPresence(presenceOf), ctx: useMetadata() };
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(calls)}>
      <ExpressionProvider app={app}>
        <Probe />
      </ExpressionProvider>
    </MetadataProvider>,
  );
  return () => latest as unknown as Reading;
}

const objectCalls = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));

/** A package-less app whose one entry requires `note`. */
const NOTES_APP = {
  name: 'notes',
  navigation: [{ id: 'nav_note', type: 'object', objectName: 'note', requiresObject: 'note' }],
};

afterEach(() => cleanup());

describe('package-less app: the chrome readers read the names-only scope (objectui#12980)', () => {
  it('(a) presence is asked by name, and the served documents are the names-only scope, with no whole-registry read', async () => {
    const calls: string[] = [];
    const read = mount(NOTES_APP, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    await waitFor(() => expect(isServedView(read().served, 'note', 'note.recent')).toBe(true));

    expect(read().presence.presence).toBe('present');
    expect(objectCalls(calls)).not.toContain('object');
    expect([...objectCalls(calls)].sort()).toEqual(['object/note', 'object/sys_activity']);
  });

  it('(a) an object the deployment does not have reads absent, by name, with no whole-registry read', async () => {
    const calls: string[] = [];
    const read = mount(NOTES_APP, calls, 'sys_missing');
    await waitFor(() => expect(read().presence.settled).toBe(true));

    expect(read().presence.presence).toBe('absent');
    expect(objectCalls(calls)).not.toContain('object');
    expect(objectCalls(calls)).toContain('object/sys_missing');
  });

  it('(a) an app that requires no object reads no served object document, and asks nothing for it', async () => {
    const calls: string[] = [];
    const read = mount({ name: 'plain', navigation: [] }, calls, '');
    await waitFor(() => expect(read().presence.settled).toBe(true));

    expect(read().served.objects).toHaveLength(0);
    expect(objectCalls(calls)).toEqual([]);
  });

  it('CONTROL: inside a package app, both read the package scope, as objectui#12811 left them', async () => {
    const calls: string[] = [];
    const read = mount({ name: 'crm', _packageId: CRM, navigation: NOTES_APP.navigation }, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    await waitFor(() => expect(isServedView(read().served, 'crm_account', 'crm_account.mine')).toBe(true));

    expect(read().presence.presence).toBe('present');
    expect([...objectCalls(calls)].sort()).toEqual([`object?package=${CRM}`, 'object/sys_activity'].sort());
  });

  it('CONTROL: outside an app (no app name), both read the whole registry, as before', async () => {
    const calls: string[] = [];
    const read = mount({}, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));

    expect(read().presence.presence).toBe('present');
    expect(isServedView(read().served, 'note', 'note.recent')).toBe(true);
    expect(objectCalls(calls)).toEqual(['object']);
  });

  it('CONTROL: once the whole registry is loaded, both read it', async () => {
    const calls: string[] = [];
    const read = mount(NOTES_APP, calls);
    await waitFor(() => expect(read().presence.settled).toBe(true));
    act(() => {
      void read().ctx.objects;
    });
    await waitFor(() => expect(read().ctx.getTypeStatus!('object')).toBe('ready'));

    expect(read().served.objects).toHaveLength(OBJECTS.length);
    expect(read().presence.presence).toBe('present');
  });
});

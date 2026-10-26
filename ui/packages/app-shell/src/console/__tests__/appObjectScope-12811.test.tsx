// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12811 — the console root starts the app's object scope.
 *
 * Measured on HotCRM behind a 50 ms round trip: the whole object list used to
 * start at the console root (`useActionModal` read `objects`), beside the
 * session's permission read. `AppContent` mounts only after that read, so a
 * scope it alone asked for started one permission round trip later.
 * `useAppObjectScopePrefetch` (mounted by `ConsoleShell`'s root action runtime)
 * asks the scope as soon as the app list names the app: the package list,
 * then by name the route object's lookup targets outside the package.
 *
 * CONTROLs: a route outside an app, a record overlay and an app item with no
 * package id ask nothing here (`AppContent` reads the whole registry there).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { useAppObjectScopePrefetch } from '../appObjectScope';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, fields: { owner: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
];

function makeAdapter(calls: string[], apps: unknown[]) {
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
          const all = type === 'object' ? OBJECTS : type === 'app' ? apps : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
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

function Prefetch() {
  useAppObjectScopePrefetch();
  return null;
}

function mount(url: string, apps: unknown[]): string[] {
  // Each mount reads its own app list, not the one a previous mount cached.
  sessionStorage.clear();
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeAdapter(calls, apps)}>
      <MemoryRouter initialEntries={[url]}>
        <Prefetch />
      </MemoryRouter>
    </MetadataProvider>,
  );
  return calls;
}

const objectCalls = (calls: string[]) => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
const APPS = [{ name: 'crm', _packageId: CRM, navigation: [] }];

afterEach(() => cleanup());

describe('the console root starts the app object scope (objectui#12811)', () => {
  it("asks the app's package list, then the route object's lookup targets by name, never the whole list", async () => {
    const calls = mount('/apps/crm/crm_account', APPS);
    await waitFor(() => expect(calls).toContain('object/sys_user'));
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object/sys_user']);
  });

  it('CONTROL: outside an app, on a record overlay, or for an app without a package id, it asks nothing', async () => {
    const outside = mount('/home', APPS);
    const overlay = mount('/apps/crm/crm_account?recordId=r1', APPS);
    const noPackage = mount('/apps/crm/crm_account', [{ name: 'crm', navigation: [] }]);
    await waitFor(() => expect(overlay).toContain('view'));
    await waitFor(() => expect(noPackage).toContain('view'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls(outside)).toEqual([]);
    expect(objectCalls(overlay)).toEqual([]);
    expect(objectCalls(noPackage)).toEqual([]);
  });
});

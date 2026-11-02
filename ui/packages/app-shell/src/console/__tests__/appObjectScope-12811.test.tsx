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
 * CONTROLs: a route outside an app, a record form overlay and an app item
 * with no package id ask nothing here (`AppContent` reads the whole registry
 * there). A record drawer (`?recordId=`) asks the scope of the list under it,
 * as `AppContent` does (objectstack#27626).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdapterCtx } from '@object-ui/react';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { enterAppBundle, useAppObjectScopePrefetch } from '../appObjectScope';

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

  it('objectstack#27626 — under a record drawer it asks the scope of the list the drawer opens over', async () => {
    const calls = mount('/apps/crm/crm_account?recordId=r1', APPS);
    await waitFor(() => expect(calls).toContain('object/sys_user'));
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object/sys_user']);
  });

  it('objectstack#28645 — enters the app\'s metadata bundle as it starts the scope, once the app list names the app', async () => {
    sessionStorage.clear();
    const calls: string[] = [];
    const entered: string[] = [];
    const adapter = Object.assign(makeAdapter(calls, APPS) as object, {
      loadAppBundle: (app: string) => { entered.push(app); return Promise.resolve(); },
    }) as Parameters<typeof MetadataProvider>[0]['adapter'];
    render(
      <AdapterCtx.Provider value={adapter as any}>
        <MetadataProvider adapter={adapter}>
          <MemoryRouter initialEntries={['/apps/crm/crm_account']}>
            <Prefetch />
          </MemoryRouter>
        </MetadataProvider>
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(entered).toEqual(['crm']));
    expect(calls).toContain(`object?package=${CRM}`);
    // `AppContent` reuses the root's entry rather than asking the bundle again;
    // another app, or the app after the root has left it, is entered.
    enterAppBundle(adapter, 'crm');
    // The console hands `AppContent` a wrapper of the same adapter.
    const wrapper = { loadAppBundle: (app: string) => (adapter as any).loadAppBundle(app) };
    enterAppBundle(wrapper, 'crm');
    expect(entered).toEqual(['crm']);
    enterAppBundle(adapter, 'hr');
    expect(entered).toEqual(['crm', 'hr']);
    cleanup();
    enterAppBundle(adapter, 'crm');
    expect(entered).toEqual(['crm', 'hr', 'crm']);
  });

  it('CONTROL: outside an app, on a record form overlay, or for an app without a package id, it asks nothing', async () => {
    const outside = mount('/home', APPS);
    const overlay = mount('/apps/crm/crm_account?form=new', APPS);
    const noPackage = mount('/apps/crm/crm_account', [{ name: 'crm', navigation: [] }]);
    // objectstack#28645 — the provider's one eager read is the app list.
    await waitFor(() => expect(overlay).toContain('app'));
    await waitFor(() => expect(noPackage).toContain('app'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls(outside)).toEqual([]);
    expect(objectCalls(overlay)).toEqual([]);
    expect(objectCalls(noPackage)).toEqual([]);
  });
});

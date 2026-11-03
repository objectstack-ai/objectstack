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
 * CONTROLs: a route outside an app and a record form overlay ask nothing here
 * (`AppContent` reads the whole registry there). An app item with no package
 * id asks the route's object and its lookup targets by name, never the whole
 * registry (objectstack#29416). A record drawer (`?recordId=`) asks the scope of the list under it,
 * as `AppContent` does (objectstack#27626).
 *
 * objectstack#29551 — inside a packaged app whose bundle is in hand, the route
 * object's lookup targets are asked without views: a target outside the bundle
 * (`sys_user`) joins the scope as a served definition and reads no
 * `/meta/view` list, while the route's object keeps the bundle's views.
 * CONTROL: a target the bundle holds reads nothing more and keeps its views.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AdapterCtx } from '@object-ui/react';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { enterAppBundle, readAppObjectScope, useAppObjectScopePrefetch } from '../appObjectScope';

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

  it('CONTROL: outside an app, or on a record form overlay, it asks nothing; an app without a package id asks by name (objectstack#29416)', async () => {
    const outside = mount('/home', APPS);
    const overlay = mount('/apps/crm/crm_account?form=new', APPS);
    const noPackage = mount('/apps/crm/crm_account', [{ name: 'crm', navigation: [] }]);
    // objectstack#28645 — the provider's one eager read is the app list.
    await waitFor(() => expect(overlay).toContain('app'));
    await waitFor(() => expect(noPackage).toContain('app'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls(outside)).toEqual([]);
    expect(objectCalls(overlay)).toEqual([]);
    expect([...objectCalls(noPackage)].sort()).toEqual(['object/crm_account', 'object/sys_user']);
  });
});

describe('objectstack#29551 — a packaged app asks its lookup targets without views', () => {
  type Doc = { name: string; [key: string]: unknown };
  const BUNDLED: Doc[] = [
    { name: 'crm_account', _packageId: CRM, fields: { owner: { type: 'lookup', reference: 'sys_user' } } },
    { name: 'crm_contact', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  ];
  const ALL: Doc[] = [...BUNDLED, { name: 'sys_user', _packageId: 'plugin.auth', fields: {} }];
  const VIEWS: Doc[] = [
    { name: 'crm_account.all', object: 'crm_account', viewKind: 'list', label: 'All accounts', isDefault: true, config: { type: 'grid', columns: [] } },
    { name: 'crm_contact.all', object: 'crm_contact', viewKind: 'list', label: 'All contacts', isDefault: true, config: { type: 'grid', columns: [] } },
    { name: 'sys_user.all', object: 'sys_user', viewKind: 'list', label: 'All users', isDefault: true, config: { type: 'grid', columns: [] } },
  ];

  /** The crm app's bundle, as the adapter's `peekAppBundle` answers once the app was entered: its two objects and their views. */
  function bundle() {
    const items = new Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>();
    const put = (type: string, docs: Doc[]) => {
      const byName = new Map();
      for (const doc of docs) byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
      items.set(type, byName);
    };
    put('object', BUNDLED);
    put('view', VIEWS.slice(0, 2));
    return { status: 'ready', items };
  }

  function makeBundledAdapter(calls: string[]) {
    const held = bundle();
    return {
      clearCache: vi.fn(),
      invalidateCache: vi.fn(),
      peekAppBundle: () => held,
      getObjectSchema(this: { getClient(): any }, name: string) {
        return this.getClient()
          .meta.getItem('object', name)
          .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
      },
      getClient: () => ({
        meta: {
          getItems: (type: string, options?: { packageId?: string }) => {
            calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
            const all = type === 'object' ? ALL : type === 'view' ? VIEWS : type === 'app' ? APPS : [];
            const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
            return Promise.resolve({ type, items: structuredClone(items) });
          },
          getItem: (type: string, name: string) => {
            calls.push(`${type}/${name}`);
            const item = (type === 'object' ? ALL : []).find((o) => o.name === name);
            return item ? Promise.resolve({ item: structuredClone(item) }) : Promise.reject(new Error('404'));
          },
        },
      }),
    } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
  }

  /** What `AppContent` reads on the route: each scope object with the list views it composed. */
  function ScopeProbe() {
    useAppObjectScopePrefetch();
    const { apps, readObjectScope } = useMetadata();
    const { pathname, search } = useLocation();
    const app = apps.find((a: any) => a?.name === 'crm');
    const read = app && readObjectScope ? readAppObjectScope(readObjectScope, app, pathname.split('/').slice(3).join('/'), search) : undefined;
    const objects: any[] = read?.scope?.objects ?? [];
    const text = objects
      .map((o) => `${o.name}[${Object.keys(o.listViews ?? {}).join('+')}]`)
      .sort()
      .join(',');
    return <div data-testid="scope">{text}</div>;
  }

  function mountBundled(url: string) {
    sessionStorage.clear();
    const calls: string[] = [];
    const view = render(
      <MetadataProvider adapter={makeBundledAdapter(calls)}>
        <MemoryRouter initialEntries={[url]}>
          <ScopeProbe />
        </MemoryRouter>
      </MetadataProvider>,
    );
    return { calls, scope: () => view.getByTestId('scope').textContent };
  }

  const reads = (calls: string[]) => calls.filter((c) => c !== 'app');

  it('a lookup target outside the bundle is asked by name without views: no /meta/view list, and the route object keeps its views', async () => {
    const { calls, scope } = mountBundled('/apps/crm/crm_account');
    await waitFor(() => expect(scope()).toContain('sys_user['));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads(calls)).toEqual([`object?package=${CRM}`, 'object/sys_user']);
    expect(scope()).toBe('crm_account[crm_account.all],crm_contact[crm_contact.all],sys_user[]');
  });

  it('CONTROL: a lookup target the bundle holds asks nothing more and keeps its views', async () => {
    const { calls, scope } = mountBundled('/apps/crm/crm_contact');
    await waitFor(() => expect(scope()).toContain('crm_contact['));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads(calls)).toEqual([`object?package=${CRM}`]);
    expect(scope()).toBe('crm_account[crm_account.all],crm_contact[crm_contact.all]');
  });
});

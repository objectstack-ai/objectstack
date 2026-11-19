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
 * then by name the route object's lookup targets outside the package, each
 * once the one `?names=` presence read has answered it served
 * (objectstack#34244).
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

function makeAdapter(calls: string[], apps: unknown[], objects: readonly { name: string }[] = OBJECTS) {
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
        getItems: (type: string, options?: { packageId?: string; names?: readonly string[] }) => {
          // objectstack#34188 — the `?names=` read answers the asked names it
          // holds and leaves an absent one out, as the list door does.
          if (options?.names) {
            calls.push(`${type}?names=${options.names.join(',')}`);
            const all: any[] = type === 'object' ? [...objects] : [];
            return Promise.resolve({ type, items: structuredClone(all.filter((o) => options.names!.includes(o.name))) });
          }
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? objects : type === 'app' ? apps : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? objects : []).find((o) => o.name === name);
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

function mount(url: string, apps: unknown[], objects?: readonly { name: string }[]): string[] {
  // Each mount reads its own app list, not the one a previous mount cached.
  sessionStorage.clear();
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeAdapter(calls, apps, objects)}>
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
  it("asks the app's package list, then the route object's lookup targets in the presence read, never the whole list", async () => {
    const calls = mount('/apps/crm/crm_account', APPS);
    await waitFor(() => expect(calls).toContain('object?names=sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // objectstack#34244 — the target outside the package is asked in the presence read;
    // objectstack#35306 — which answered it served, so it is not asked again by name.
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object?names=sys_user']);
  });

  it('objectstack#27626 — under a record drawer it asks the scope of the list the drawer opens over', async () => {
    const calls = mount('/apps/crm/crm_account?recordId=r1', APPS);
    await waitFor(() => expect(calls).toContain('object?names=sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object?names=sys_user']);
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
    // objectstack#34188 — the lookup target is asked in the `?names=` read, and
    // (objectstack#35306) answered by it: no by-name read of its own.
    expect([...objectCalls(noPackage)].sort()).toEqual(['object/crm_account', 'object?names=sys_user']);
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
          getItems: (type: string, options?: { packageId?: string; names?: readonly string[] }) => {
            // objectstack#34244 — the `?names=` presence read answers the asked names it holds.
            if (options?.names) {
              calls.push(`${type}?names=${options.names.join(',')}`);
              const named = type === 'object' ? ALL.filter((o) => options.names!.includes(o.name)) : [];
              return Promise.resolve({ type, items: structuredClone(named) });
            }
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

  it('a lookup target outside the bundle is answered without views: no /meta/view list, and the route object keeps its views', async () => {
    const { calls, scope } = mountBundled('/apps/crm/crm_account');
    await waitFor(() => expect(scope()).toContain('sys_user['));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // objectstack#35306 — the presence read that served it is its one read.
    expect(reads(calls)).toEqual([`object?package=${CRM}`, 'object?names=sys_user']);
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

describe('objectstack#33343 — a hidden lookup asks no definition of its target', () => {
  /**
   * The route object carries the injected system scope anchors as the server
   * serves them: `organization_id` and `owning_business_unit_id`, hidden
   * lookups to `sys_organization` and `sys_business_unit`. No cell draws a
   * hidden field, and the metadata door answers a definition the caller may
   * not read as absent, so a member was answered 404 on every route.
   */
  const withAnchors = (hidden: boolean) => [
    {
      name: 'crm_account',
      _packageId: CRM,
      fields: {
        owner: { type: 'lookup', reference: 'sys_user' },
        organization_id: { type: 'lookup', reference: 'sys_organization', hidden, system: true },
        owning_business_unit_id: { type: 'lookup', reference: 'sys_business_unit', hidden, system: true },
      },
    },
    { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
    { name: 'sys_organization', _packageId: 'plugin.auth', fields: {} },
    { name: 'sys_business_unit', _packageId: 'plugin.security', fields: {} },
  ];

  it('the route asks its drawn lookup target, and never the targets of its hidden lookups', async () => {
    const calls = mount('/apps/crm/crm_account', APPS, withAnchors(true));
    await waitFor(() => expect(calls).toContain('object?names=sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object?names=sys_user']);
  });

  it('CONTROL: the same lookups drawn ask every registered target, in one presence read', async () => {
    const calls = mount('/apps/crm/crm_account', APPS, withAnchors(false));
    await waitFor(() => expect(calls).toContain('object?names=sys_user,sys_organization,sys_business_unit'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // objectstack#34244 — the three targets outside the package are asked in ONE `?names=` read;
    // objectstack#35306 — it served all three, so none is asked again by name.
    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object?names=sys_user,sys_organization,sys_business_unit']);
  });
});

describe('objectstack#34188 — a lookup target the host does not register is never asked by name', () => {
  /**
   * The control plane's Members page binds `sys_invitation`, whose drawn
   * `business_unit_id` lookup points at `sys_business_unit`, an object the
   * control plane does not register: asked by name it answered 404 on every
   * open. Its app has no package, so the page reads the names-only scope.
   * The list door's `?names=` read answers an absent name by leaving it out,
   * and this adapter answers it so.
   */
  const CP_OBJECTS = [
    {
      name: 'sys_invitation',
      fields: {
        business_unit_id: { type: 'lookup', reference: 'sys_business_unit' },
        inviter_id: { type: 'lookup', reference: 'sys_user' },
      },
    },
    { name: 'sys_user', fields: {} },
  ];
  const CP_APPS = [{ name: 'cp', navigation: [] }];
  const TEAM_PAGE = { name: 'team', object: 'sys_invitation' };

  function makeListingAdapter(calls: string[]) {
    return {
      clearCache: vi.fn(),
      invalidateCache: vi.fn(),
      getObjectSchema(this: { getClient(): any }, name: string) {
        return this.getClient()
          .meta.getItem('object', name)
          .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
      },
      getClient: () => ({
        meta: {
          getItems: (type: string, options?: { names?: readonly string[] }) => {
            const all: any[] = type === 'object' ? CP_OBJECTS : type === 'app' ? CP_APPS : [];
            if (options?.names) {
              calls.push(`${type}?names=${options.names.join(',')}`);
              return Promise.resolve({ type, items: structuredClone(all.filter((o) => options.names!.includes(o.name))) });
            }
            calls.push(type);
            return Promise.resolve({ type, items: structuredClone(all) });
          },
          getItem: (type: string, name: string) => {
            calls.push(`${type}/${name}`);
            const item = (type === 'object' ? CP_OBJECTS : []).find((o) => o.name === name);
            return item ? Promise.resolve({ item: structuredClone(item) }) : Promise.reject(new Error('404'));
          },
        },
      }),
    } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
  }

  /** What the route reads, through the same `readAppObjectScope` `AppContent` reads. */
  function RouteProbe({ subPath }: { subPath: string }) {
    const { apps, readObjectScope } = useMetadata();
    const app = apps.find((a: any) => a?.name === 'cp');
    const read =
      app && readObjectScope
        ? readAppObjectScope(readObjectScope, app, subPath, '', [], () => ({ page: TEAM_PAGE, settled: true }))
        : undefined;
    const names = ((read?.scope?.objects ?? []) as any[]).map((o) => o?.name).sort().join(',');
    return <div data-testid="scope">{names}</div>;
  }

  function mountRoute(subPath: string) {
    sessionStorage.clear();
    const calls: string[] = [];
    const view = render(
      <MetadataProvider adapter={makeListingAdapter(calls)}>
        <MemoryRouter initialEntries={['/']}>
          <RouteProbe subPath={subPath} />
        </MemoryRouter>
      </MetadataProvider>,
    );
    return { calls, scope: () => view.getByTestId('scope').textContent };
  }

  it.each([
    ['a page bound to the object', 'page/team'],
    ["the object's own list route", 'sys_invitation'],
  ])('%s asks no definition of the unregistered target by name', async (_arm, subPath) => {
    const { calls, scope } = mountRoute(subPath);
    await waitFor(() => expect(scope()).toContain('sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).not.toContain('object/sys_business_unit');
    // Asked once, in the read that leaves an absent name out.
    expect(calls.filter((c) => c.includes('sys_business_unit'))).toEqual(['object?names=sys_business_unit,sys_user']);
  });

  it.each([
    ['a page bound to the object', 'page/team'],
    ["the object's own list route", 'sys_invitation'],
  ])('CONTROL: on %s a registered target still resolves into the scope', async (_arm, subPath) => {
    const { calls, scope } = mountRoute(subPath);
    await waitFor(() => expect(scope()).toBe('sys_invitation,sys_user'));
    // objectstack#35306 — from the presence read that served it, not a by-name read.
    expect(calls).not.toContain('object/sys_user');
  });
});

describe('objectstack#34244 — a packaged app asks an off-package lookup target or a requiresObject by name only once it is served', () => {
  /**
   * A packaged app whose account object draws a lookup to
   * `sys_approval_request`, and whose navigation requires `cloud_billing`:
   * a Free environment registers neither, and asked by name each answered 404
   * on every open (cloud#4300's staging note). `sys_user` is registered
   * outside the package; `crm_account` is the package's own.
   */
  const PKG_OBJECTS = [
    {
      name: 'crm_account',
      _packageId: CRM,
      fields: {
        owner: { type: 'lookup', reference: 'sys_user' },
        approval: { type: 'lookup', reference: 'sys_approval_request' },
      },
    },
    { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
  ];
  const entry = (name: string) => ({ id: `nav_${name}`, type: 'object', objectName: name, requiresObject: name });
  const PKG_APPS = [{ name: 'crm', _packageId: CRM, navigation: [entry('crm_account'), entry('sys_user'), entry('cloud_billing')] }];
  const ACCOUNTS_PAGE = { name: 'accounts_home', object: 'crm_account' };

  function RouteProbe({ subPath, search = '' }: { subPath: string; search?: string }) {
    const { apps, readObjectScope } = useMetadata();
    const app = apps.find((a: any) => a?.name === 'crm');
    const read =
      app && readObjectScope
        ? readAppObjectScope(readObjectScope, app, subPath, search, [], () => ({ page: ACCOUNTS_PAGE, settled: true }))
        : undefined;
    const names = ((read?.scope?.objects ?? []) as any[]).map((o) => o?.name).sort().join(',');
    return <div data-testid="scope">{names}</div>;
  }

  function mountRoute(subPath: string, search = '') {
    sessionStorage.clear();
    const calls: string[] = [];
    const view = render(
      <MetadataProvider adapter={makeAdapter(calls, PKG_APPS, PKG_OBJECTS)}>
        <MemoryRouter initialEntries={['/']}>
          <RouteProbe subPath={subPath} search={search} />
        </MemoryRouter>
      </MetadataProvider>,
    );
    return { calls, scope: () => view.getByTestId('scope').textContent };
  }

  const ARMS = [
    ['a page bound to the object', 'page/accounts_home'],
    ["the object's own list route", 'crm_account'],
  ] as const;

  it.each(ARMS)('%s asks neither unregistered name by name, each only in a presence read', async (_arm, subPath) => {
    const { calls, scope } = mountRoute(subPath);
    await waitFor(() => expect(scope()).toBe('crm_account,sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).not.toContain('object/sys_approval_request');
    expect(calls).not.toContain('object/cloud_billing');
    // Two presence reads: the app's required names outside the package as the
    // package list lands, then the route object's lookup targets it does not
    // already ask, once its definition lands. The package's own object is in neither.
    expect(objectCalls(calls).filter((c) => c.startsWith('object?names='))).toEqual([
      'object?names=sys_user,cloud_billing',
      'object?names=sys_approval_request',
    ]);
  });

  it.each(ARMS)('with the command palette open, %s asks no entry object it requires and the host lacks by name', async (_arm, subPath) => {
    const { calls, scope } = mountRoute(subPath, '?palette=1');
    await waitFor(() => expect(scope()).toBe('crm_account,sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).not.toContain('object/cloud_billing');
    // objectstack#35306 — the served `sys_user` is answered by the presence read.
    expect(calls).not.toContain('object/sys_user');
  });

  it.each(ARMS)('CONTROL: on %s a registered off-package target and requiresObject still resolve, from the presence read', async (_arm, subPath) => {
    const { calls, scope } = mountRoute(subPath);
    await waitFor(() => expect(scope()).toBe('crm_account,sys_user'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // objectstack#35306 — the presence read served it, so no by-name read follows.
    expect(calls).not.toContain('object/sys_user');
    expect(calls).toContain(`object?package=${CRM}`);
  });
});

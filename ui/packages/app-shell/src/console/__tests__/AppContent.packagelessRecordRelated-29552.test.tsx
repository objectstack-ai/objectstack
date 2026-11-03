// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29552 — a record route with no declared record page, in an app
 * created in the console (its served item names no package), reads the objects
 * that point at the record's object from the app bundle, never the whole
 * object registry.
 *
 * Measured on a production Console (app-crm, a console-created app's
 * `crm_account` record with no declared record page): the registry was
 * 553,397 B of the route's 888,599 B. Its synthesized page reads the registry
 * only to derive its related lists (`deriveRelatedLists`: every object with a
 * `lookup` / `master_detail` field whose `reference` names the record's
 * object), and the server adds every such object to the app's bundle for an
 * object the app's navigation reaches (`inboundRelationObjects`).
 *
 * The harness is the one `AppContent.emptyPackageScope-13046` uses: the REAL
 * `MetadataProvider` under the real `AppContent`, with a client double that
 * records each call as its URL would read. Here it also carries the app bundle
 * the server builds for each app, and answers a bundled object's by-name read
 * from it without a request, as the adapter does (`installBundledItemReads`).
 * The record view stands in for `RecordDetailView`: it draws the related lists
 * the real `deriveRelatedLists` derives from the objects it is handed.
 *
 * Pins:
 *   (a) a package-less app's record route of an object its navigation reaches
 *       reads no object list: the record's object, its lookup target and the
 *       objects that point at it, by name, the bundled ones from the bundle;
 *   (b) CONTROL: the related lists it draws are the set the whole registry
 *       draws today;
 *   (c) while the app's bundle is on the wire the route reads nothing, then
 *       reads by name;
 *   (e) with the bundle in the object list's order, the related lists are
 *       drawn in the order the registry draws them, even when an app's
 *       `requiresObject` names one of the related objects (it lands first);
 *   (d) CONTROLs, the registry as before: an object outside the app's
 *       navigation, no bundle, a bundle that holds no app, and a record drawer
 *       over the route.
 *
 * objectstack#29681 — the last describe pins the same route in a packaged app,
 * read through its package scope; it replaces the CONTROL that pinned that
 * route to the registry.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { AuthProvider, ActiveOrganizationStorage } from '@object-ui/auth';
import type { AuthClient, AuthOrganization } from '@object-ui/auth';
import { deriveRelatedLists } from '../../utils/deriveRelatedLists';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => null,
  EditAppPage: () => null,
  DashboardDesignPage: () => null,
}));
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => <div data-testid="console-layout">{children}</div>,
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: ({ objects }: { objects: Array<{ name: string }> }) => (
    <div data-testid="object-view">{objects.map((o) => o.name).join(',')}</div>
  ),
}));
vi.mock('../../views/RecordDetailView', async () => {
  const { deriveRelatedLists: derive } = await import('../../utils/deriveRelatedLists');
  return {
    RecordDetailView: ({ objects }: { objects: Array<{ name: string }> }) => {
      const { objectName } = useParams();
      const def = objects.find((o) => o.name === objectName);
      const related = def ? derive(def as never, objects as never[]).map((r) => `${r.childObject}.${r.referenceField}`) : [];
      return <div data-testid="record-view" data-related={related.join(',')}>{objects.map((o) => o.name).join(',')}</div>;
    },
  };
});
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label, objectPluralLabel: () => '' }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';
import { MetadataProvider } from '../../providers/MetadataProvider';

type Doc = { name: string; [key: string]: unknown };

const CRM = 'app.crm';
/** In the order the registry lists them (app-crm's: registration order, not the alphabet). */
const OBJECTS: Doc[] = [
  { name: 'crm_account', _packageId: CRM, fields: { owner: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'crm_activity', _packageId: CRM, fields: { what: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_contact', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_lead', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  {
    name: 'crm_opportunity',
    _packageId: CRM,
    fields: { account: { type: 'master_detail', reference: 'crm_account' }, partner: { type: 'lookup', reference: 'crm_account' } },
  },
  { name: 'crm_campaign', _packageId: CRM, fields: {} },
  { name: 'crm_case', _packageId: 'app.service', fields: { contact: { type: 'lookup', reference: 'crm_contact' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
];
const objectEntry = (name: string) => ({ id: `nav_${name}`, type: 'object', label: name, objectName: name });

/** The console-created app: no `_packageId`. Its navigation reaches the account and the contact. */
const OPS_APP = { name: 'ops', label: 'Ops', navigation: [objectEntry('crm_account'), { id: 'g', type: 'group', label: 'More', children: [objectEntry('crm_contact')] }] };
/** A console-created app whose account entry requires a related object: that name is asked, and lands, first. */
const REQUIRES_APP = {
  name: 'requires',
  label: 'Requires',
  navigation: [{ ...objectEntry('crm_account'), requiresObject: 'crm_opportunity' }, objectEntry('crm_contact')],
};
/** The packaged app, over the same objects. */
const CRM_APP = { name: 'crm', label: 'CRM', _packageId: CRM, navigation: [objectEntry('crm_account'), objectEntry('crm_contact')] };

/**
 * What the server's bundle holds for an app: its navigation's objects, and
 * every object pointing at one, in the object list's order.
 */
function serverBundle(app: Doc) {
  const reach = ['crm_account', 'crm_contact'];
  const points = (o: Doc) =>
    Object.values((o.fields ?? {}) as Record<string, any>).some((f) => (f.type === 'lookup' || f.type === 'master_detail') && reach.includes(f.reference));
  const members = server.objects.filter((o) => reach.includes(o.name) || points(o));
  const items = new Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>();
  const put = (type: string, docs: Doc[]) => {
    const byName = new Map();
    for (const doc of docs) byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
    items.set(type, byName);
  };
  put('app', [app]);
  put('object', members);
  put('view', []);
  put('page', []);
  put('dashboard', []);
  return items;
}

type Peek = { status: 'none' } | { status: 'pending'; settled: Promise<unknown> } | { status: 'ready'; items: ReturnType<typeof serverBundle> };
const server = { calls: [] as string[], peek: null as Peek | null, objects: OBJECTS, pages: [] as Doc[] };

function makeAdapter() {
  const host: Record<string, unknown> = {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all: Doc[] =
            type === 'object' ? server.objects : type === 'app' ? [OPS_APP, REQUIRES_APP, CRM_APP] : type === 'page' ? server.pages : [];
          const items = options?.packageId ? all.filter((o) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          // The adapter answers an item the active bundle holds from it, asked of no route.
          const peek = server.peek;
          const bundled = peek?.status === 'ready' ? peek.items.get(type)?.get(name) : undefined;
          if (bundled) return Promise.resolve(structuredClone(bundled.envelope));
          server.calls.push(`${type}/${name}`);
          const item = (type === 'object' ? server.objects : []).find((o) => o.name === name);
          return item
            ? Promise.resolve({ type, name, item: structuredClone(item) })
            : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
        },
      },
    }),
  };
  if (server.peek) host.peekAppBundle = () => server.peek;
  return host as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const USER = 'u_29552r';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-29552r', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'owner' })),
  } as unknown as AuthClient;
}

function boot(url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={authClient()}>
      <MetadataProvider adapter={makeAdapter()}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MetadataProvider>
    </AuthProvider>,
  );
}

const objectCalls = () => server.calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
const sorted = (list: readonly string[]) => [...list].sort();
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
/** The related lists the whole registry draws for `objectName` today. */
const registryRelated = (objectName: string) =>
  deriveRelatedLists(server.objects.find((o) => o.name === objectName) as never, server.objects as never[]).map(
    (r) => `${r.childObject}.${r.referenceField}`,
  );
const drawnRelated = () => (screen.getByTestId('record-view').getAttribute('data-related') ?? '').split(',').filter(Boolean);

beforeEach(() => {
  server.calls = [];
  server.objects = OBJECTS;
  server.pages = [];
  server.peek = { status: 'ready', items: serverBundle(OPS_APP) };
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('a package-less app’s record route with no declared record page reads its related objects from the bundle (objectstack#29552)', () => {
  it('(a) reads no object list: the record object, its lookup target and the objects pointing at it, by name', async () => {
    boot('/apps/ops/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_activity'));
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('sys_user'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    // Every bundled object is answered from the bundle; the lookup target outside it is asked by name.
    expect(objectCalls()).toEqual(['object/sys_user']);
    expect(sorted((screen.getByTestId('record-view').textContent ?? '').split(','))).toEqual(
      sorted(['crm_account', 'crm_activity', 'crm_contact', 'crm_lead', 'crm_opportunity', 'sys_user']),
    );
  });

  it('(b) CONTROL: the related lists drawn are the set the whole registry draws today', async () => {
    boot('/apps/ops/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_activity'));
    await settle();

    expect(registryRelated('crm_account')).toHaveLength(5);
    expect(sorted(drawnRelated())).toEqual(sorted(registryRelated('crm_account')));
  });

  it('(b) CONTROL: an object reached inside a navigation group, pointed at from another package', async () => {
    boot('/apps/ops/crm_contact/record/c1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_case'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    expect(sorted(drawnRelated())).toEqual(sorted(registryRelated('crm_contact')));
  });

  it('(c) while the bundle is on the wire it reads nothing, then reads by name', async () => {
    let land!: () => void;
    const settled = new Promise<void>((resolve) => {
      land = resolve;
    });
    server.peek = { status: 'pending', settled };
    boot('/apps/ops/crm_account/record/r1');
    await settle();
    expect(objectCalls()).toEqual([]);
    expect(screen.queryByTestId('record-view')).toBeNull();

    server.peek = { status: 'ready', items: serverBundle(OPS_APP) };
    land();
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_activity'));
    await settle();
    expect(objectCalls()).toEqual(['object/sys_user']);
  });
});

describe('the related lists keep the registry’s order (objectstack#29552)', () => {
  it('(e) with the bundle in the object list’s order, the lists are drawn in the order the registry draws them', async () => {
    boot('/apps/ops/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_lead'));
    await settle();

    expect(registryRelated('crm_account')).toEqual([
      'crm_opportunity.account',
      'crm_activity.what',
      'crm_contact.account',
      'crm_lead.account',
      'crm_opportunity.partner',
    ]);
    expect(drawnRelated()).toEqual(registryRelated('crm_account'));
  });

  it('(e) …even when the app’s `requiresObject` names a related object, which lands first', async () => {
    server.peek = { status: 'ready', items: serverBundle(REQUIRES_APP) };
    boot('/apps/requires/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_lead'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    expect(drawnRelated()).toEqual(registryRelated('crm_account'));
  });
});

describe('CONTROLs: the registry as before (objectstack#29552)', () => {
  it('an object outside the app’s navigation reads the registry', async () => {
    boot('/apps/ops/crm_opportunity/record/o1');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();
    expect(objectCalls()).toEqual(['object']);
  });

  it('no bundle reads the registry', async () => {
    server.peek = null;
    boot('/apps/ops/crm_account/record/r1');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();
    expect(objectCalls()).toEqual(['object']);
  });

  it('a bundle that answered without the app reads the registry', async () => {
    server.peek = { status: 'ready', items: new Map() };
    boot('/apps/ops/crm_account/record/r1');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();
    expect(objectCalls()).toEqual(['object']);
  });

  it('a record drawer over the route reads the registry beside it (objectstack#27626)', async () => {
    boot('/apps/ops/crm_account/record/r1?recordId=r2');
    await waitFor(() => expect(objectCalls()).toContain('object'));
  });

});

/**
 * objectstack#29681 — the same route in a PACKAGED app reads its names through
 * the app's package scope: the package list, then by name each name the list
 * does not hold. The CONTROL that pinned this route to the registry
 * ("a packaged app's record route is unchanged") is flipped here.
 *
 * Measured on a production Console (app-crm, `crm_app`, the Initech
 * `crm_account` record, no declared record page): the registry was 561,247 B
 * of the route's 1,584,710 B, with the `/meta/view` list (7,014 B) read beside
 * it.
 */
describe('a packaged app’s record route with no declared record page reads its package scope, not the registry (objectstack#29681)', () => {
  /**
   * An object outside the app's package that points at the account, listed
   * between the package's own objects: saved in the environment, as an object
   * created in Studio is. The bundle holds it; the package list does not.
   */
  const VISIT: Doc = { name: 'ops_visit', _packageId: 'sys_metadata', fields: { account: { type: 'lookup', reference: 'crm_account' } } };
  const WITH_VISIT: Doc[] = [...OBJECTS.slice(0, 2), VISIT, ...OBJECTS.slice(2)];
  const ACCOUNT_PAGE: Doc = {
    name: 'account_detail',
    type: 'record',
    object: 'crm_account',
    kind: 'full',
    regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { objectName: 'crm_contact' } }] }],
  };

  beforeEach(() => {
    server.objects = WITH_VISIT;
    server.peek = { status: 'ready', items: serverBundle(CRM_APP) };
  });

  it('reads no unscoped object list: the package list, and by name only the lookup target outside the bundle', async () => {
    boot('/apps/crm/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('ops_visit'));
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('sys_user'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    // The object of another package is answered from the bundle, asked of no route.
    expect(objectCalls()).toEqual(['object?package=app.crm', 'object/sys_user']);
  });

  it('draws the registry’s related lists in the registry’s order, the object of another package in its place', async () => {
    boot('/apps/crm/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('ops_visit'));
    await settle();

    expect(registryRelated('crm_account')).toEqual([
      'crm_opportunity.account',
      'crm_activity.what',
      'ops_visit.account',
      'crm_contact.account',
      'crm_lead.account',
      'crm_opportunity.partner',
    ]);
    expect(drawnRelated()).toEqual(registryRelated('crm_account'));
  });

  it('an object pointed at only from another package draws that list', async () => {
    boot('/apps/crm/crm_contact/record/c1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_case'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    expect(registryRelated('crm_contact')).toEqual(['crm_case.contact']);
    expect(drawnRelated()).toEqual(registryRelated('crm_contact'));
  });

  it('CONTROL: a declared record page reads the objects it binds, as before', async () => {
    server.pages = [ACCOUNT_PAGE];
    boot('/apps/crm/crm_account/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_contact'));
    await settle();

    expect(objectCalls()).toEqual(['object?package=app.crm', 'object/sys_user']);
    expect(screen.getByTestId('record-view').textContent).not.toContain('ops_visit');
  });

  it('CONTROL: an object outside the app’s navigation reads the registry', async () => {
    boot('/apps/crm/crm_opportunity/record/o1');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();
    expect(objectCalls()).toEqual(['object']);
  });

  it('CONTROL: no bundle reads the registry', async () => {
    server.peek = null;
    boot('/apps/crm/crm_account/record/r1');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();
    expect(objectCalls()).toEqual(['object']);
  });

  it('CONTROL: a record drawer over the route reads the registry beside it (objectstack#27626)', async () => {
    boot('/apps/crm/crm_account/record/r1?recordId=r2');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    expect(objectCalls()).toContain('object?package=app.crm');
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29416 — an object route of an app created in the console (no
 * `_packageId`) reads its object by name now, not the whole registry, so the
 * object type stays idle and the label sites' served reads
 * (`useServedViewItems`) answer from the names-only scope.
 *
 * Harness: the REAL `MetadataProvider` with an app bundle already in hand
 * (`peekAppBundle`), the route's reads as `AppContent` makes them
 * (`readAppObjectScope`), the sidebar's gate (`useNavMemberGates`) and the
 * served reads, under the app's expression context. The app's entries name no
 * `requiresObject` for the route's object (the usual console-built app).
 *
 * Pins:
 *   - the route object's views stay served, and the tab and crumb labels
 *     (`viewTabLabel`, which both read) are byte-identical to the labels the
 *     whole lists give, which is what this route read before (CONTROL, in the
 *     same tree once the registry is loaded);
 *   - no `/meta/view` list is read on the way, though the gate's cross-app
 *     union names another app's object outside the bundle;
 *   - the provider: a names-only read with views composes the views of the
 *     names its reader asked, never of every name the shared entry holds.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { readAppObjectScope } from '../../console/appObjectScope';
import { useNavMemberGates } from '../useNavMemberGates';
import { useServedViewItems, isServedView } from '../useServedViewItems';
import { viewTabLabel } from '../../views/viewTabLabel';

type Doc = { name: string; [key: string]: unknown };

const OBJECTS: Doc[] = [
  // `mine` is a view the object document embeds; `note.all` a `/meta/view` document.
  { name: 'note', label: 'Note', fields: {}, listViews: { mine: { type: 'grid', label: 'My notes (served)' } } },
  { name: 'crm_account', _packageId: 'app.crm', label: 'Account', fields: {} },
];
const VIEWS: Doc[] = [
  { name: 'note.all', object: 'note', viewKind: 'list', label: 'All notes (served)', isDefault: true, config: { type: 'grid', columns: [] } },
  { name: 'crm_account.all', object: 'crm_account', viewKind: 'list', label: 'All accounts', isDefault: true, config: { type: 'grid', columns: [] } },
];

const NOTES_APP = {
  name: 'notes',
  navigation: [{ id: 'nav_note', type: 'object', label: 'Notes', objectName: 'note' }],
};
const CRM_APP = {
  name: 'crm',
  _packageId: 'app.crm',
  navigation: [{ id: 'nav_acc', type: 'object', label: 'Accounts', objectName: 'crm_account', requiresObject: 'crm_account' }],
};

function bundleItems() {
  const items = new Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>();
  const put = (type: string, docs: Doc[]) => {
    const byName = new Map();
    for (const doc of docs) byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
    items.set(type, byName);
  };
  put('object', [OBJECTS[0]]);
  put('view', [VIEWS[0]]);
  put('page', []);
  put('dashboard', []);
  return items;
}

function makeAdapter(calls: string[]) {
  const bundle = { status: 'ready', items: bundleItems() };
  return {
    clearCache: () => {},
    invalidateCache: () => {},
    peekAppBundle: () => bundle,
    getObjectSchema: (name: string) => {
      calls.push(`object/${name}`);
      const item = OBJECTS.find((o) => o.name === name);
      return item ? Promise.resolve(structuredClone(item)) : Promise.reject(Object.assign(new Error('nf'), { httpStatus: 404 }));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          calls.push(type);
          const all = type === 'object' ? OBJECTS : type === 'view' ? VIEWS : type === 'app' ? [NOTES_APP, CRM_APP] : [];
          return Promise.resolve({ type, items: structuredClone(all) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          return Promise.reject(Object.assign(new Error('nf'), { httpStatus: 404 }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

type Reading = {
  ctx: ReturnType<typeof useMetadata>;
  served: ReturnType<typeof useServedViewItems>;
  routeObject: { listViews?: Record<string, { label?: unknown }> } | undefined;
};

/** The note route, read as `AppContent` reads it, with the gate and the served reads beside it. */
function mountRoute(calls: string[]): () => Reading {
  sessionStorage.clear();
  let latest: Reading | null = null;
  function Route() {
    const ctx = useMetadata();
    useNavMemberGates();
    const read = readAppObjectScope(ctx.readObjectScope, NOTES_APP, 'note', '');
    const objects = (read.scope ? read.scope.objects : ctx.objects) as Array<{ name: string }>;
    latest = {
      ctx,
      served: useServedViewItems(),
      routeObject: objects.find((o) => o.name === 'note') as Reading['routeObject'],
    };
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(calls)}>
      <MemoryRouter initialEntries={['/apps/notes/note']}>
        <ExpressionProvider app={NOTES_APP}>
          <Route />
        </ExpressionProvider>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return () => latest as unknown as Reading;
}

/** A bundle pass that changes the text, so a served view drawn through it would read differently. */
const throughBundle = (_object: string, _view: string, text: string) => `bundle(${text})`;

/** The tab and crumb labels of the route object's views, as `viewTabLabel` draws them. */
function labels(read: Reading): Record<string, string> {
  const views = read.routeObject?.listViews ?? {};
  return Object.fromEntries(
    Object.entries(views).map(([id, view]) => [
      id,
      viewTabLabel({ id, name: id, label: view.label }, 'note', read.served, throughBundle, 'Unlabelled', 'en'),
    ]),
  );
}

afterEach(() => cleanup());

describe('a package-less app’s object route keeps its views served (objectstack#29416)', () => {
  it('the route object’s views are served and labelled as the whole lists label them, with no list read', async () => {
    const calls: string[] = [];
    const read = mountRoute(calls);
    await waitFor(() => expect(Object.keys(read().routeObject?.listViews ?? {}).sort()).toEqual(['mine', 'note.all']));
    await waitFor(() => expect(isServedView(read().served, 'note', 'note.all')).toBe(true));

    expect(isServedView(read().served, 'note', 'mine')).toBe(true);
    const scoped = labels(read());
    expect(scoped).toEqual({ mine: 'My notes (served)', 'note.all': 'All notes (served)' });
    expect(calls.filter((c) => !c.includes('/'))).toEqual(['app']);
    expect(read().ctx.getTypeStatus!('object')).toBe('idle');

    // CONTROL: the same tree once the whole registry is loaded, which is what
    // this route read before: byte-identical labels.
    act(() => {
      void read().ctx.objects;
    });
    await waitFor(() => expect(read().ctx.getTypeStatus!('object')).toBe('ready'));
    expect(calls).toContain('object');
    expect(labels(read())).toEqual(scoped);
  });

  it('the provider composes a names-only read’s views for the names its reader asked, not the whole shared entry', async () => {
    const calls: string[] = [];
    let ctx: ReturnType<typeof useMetadata> | null = null;
    function Probe() {
      ctx = useMetadata();
      return null;
    }
    render(
      <MetadataProvider adapter={makeAdapter(calls)}>
        <Probe />
      </MetadataProvider>,
    );
    const metadata = () => ctx as unknown as ReturnType<typeof useMetadata>;
    await waitFor(() => expect(calls).toContain('app'));
    type ReadNoViews = (scope: { names: string[]; views: false }) => { settled: boolean };
    const union = () => (metadata().readObjectScope as unknown as ReadNoViews)({ names: ['note', 'crm_account'], views: false });
    act(() => {
      union();
    });
    await waitFor(() => expect(union().settled).toBe(true));
    await waitFor(() => expect(metadata().readObjectScope!({ names: ['note'] }).settled).toBe(true));

    expect(calls).not.toContain('view');
  });
});

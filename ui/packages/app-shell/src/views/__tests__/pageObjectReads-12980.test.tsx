// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — a page and the blocks placed on it read the objects they
 * name, never the whole object registry (`GET /api/v1/meta/object`, 751 KB on
 * the card's control plane).
 *
 * Two halves:
 *
 *   - `PageView` in an app item with no package id (none here: the page is
 *     mounted outside an app's expression scope) reads the objects its page
 *     binds through the names-only scope, by name, and an object a block asks
 *     about outside them by name. The harness is the REAL `MetadataProvider`
 *     with a client double that records each call as its URL would read.
 *   - The three page blocks that read `useMetadata().objects` on render:
 *     the interface list page reads its source object by name, `nav:menu`'s
 *     capability gate reads the objects the app's entries require by name, and
 *     `global:search` reads the registry only once the user types. Each is
 *     mounted under a metadata context that records what is read off it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdapterCtx, MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string; name?: string }) => o?.defaultValue ?? o?.name ?? k,
    language: 'en',
  }),
}));
vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../../hooks/useStudioDesignGate', () => ({ useStudioDesignGate: () => null }));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    // Stands in for the page's blocks: it asks the page's record navigator
    // about `sys_user`, an object the page does not bind, as a lookup cell does.
    SchemaRenderer: () => {
      const navigator = actual.useRelatedRecordActions();
      const href = navigator?.recordHref?.('sys_user', 'u1') ?? '';
      return <div data-testid="page-blocks" data-lookup-href={href} />;
    },
  };
});

import { MetadataProvider } from '../../providers/MetadataProvider';
import { PageView } from '../PageView';
import { InterfaceListPage } from '../InterfaceListPage';
import { NavMenuRenderer } from '../nav-menu-renderer';
import { GlobalSearchRenderer } from '../global-search-renderer';

const OBJECTS = [
  { name: 'crm_account', _packageId: 'app.crm', fields: { name: { type: 'text' } } },
  { name: 'crm_case', _packageId: 'app.service', fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: { name: { type: 'text' } } },
];
const PAGE = {
  name: 'case_board',
  label: 'Case board',
  type: 'app',
  regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'crm_case' } }] }],
};

const calls: string[] = [];
const objectCalls = () => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
const held: Array<() => void> = [];
let holdByName = false;

function adapter() {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'page' ? [PAGE] : [];
          return Promise.resolve({ type, items: structuredClone(all) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          const answer = () => (item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(new Error('404')));
          if (!holdByName) return answer();
          return new Promise((resolve, reject) => held.push(() => answer().then(resolve, reject)));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

beforeEach(() => {
  calls.length = 0;
  held.length = 0;
  holdByName = false;
});
afterEach(cleanup);

describe('PageView in an app with no package reads its page\'s objects by name (objectui#12980)', () => {
  it('reads the bound object by name, and a block\'s other object by name when it asks, never the whole registry', async () => {
    render(
      <MetadataProvider adapter={adapter()}>
        <AdapterCtx.Provider value={{} as never}>
          <MemoryRouter initialEntries={['/apps/crm/page/case_board']}>
            <Routes>
              <Route path="/apps/:appName/page/:pageName" element={<PageView />} />
            </Routes>
          </MemoryRouter>
        </AdapterCtx.Provider>
      </MetadataProvider>,
    );
    holdByName = true;
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toBeInTheDocument());
    await waitFor(() => expect(calls).toContain('object/sys_user'));
    expect(screen.getByTestId('page-blocks').getAttribute('data-lookup-href')).toBe('');

    act(() => held.splice(0).forEach((go) => go()));
    await waitFor(() =>
      expect(screen.getByTestId('page-blocks').getAttribute('data-lookup-href')).toBe('/apps/crm/sys_user/record/u1'),
    );
    expect(objectCalls()).toContain('object/crm_case');
    // objectui#13044 — the by-name read now goes through the adapter's
    // `getObjectSchema`; each name still reaches the by-name door once.
    expect(objectCalls().filter((c) => c === 'object/crm_case')).toHaveLength(1);
    expect(objectCalls().filter((c) => c === 'object/sys_user')).toHaveLength(1);
    expect(objectCalls()).not.toContain('object');
    expect(objectCalls().some((c) => c.startsWith('object?'))).toBe(false);
  });
});

/** A metadata context that records each read off it. */
function recordingContext(apps: unknown[] = []) {
  const reads = { objects: 0, scopes: [] as Array<{ packageId?: string; names?: readonly string[] }>, ensured: [] as string[] };
  const value = {
    apps,
    get objects() {
      reads.objects += 1;
      return OBJECTS;
    },
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async (type: string) => {
      reads.ensured.push(type);
      return [];
    },
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'idle' as const,
    readObjectScope: (scope: { packageId?: string; names?: readonly string[] }) => {
      reads.scopes.push(scope);
      const objects = OBJECTS.filter((o) => scope.names?.includes(o.name));
      return { objects, served: objects, missing: (scope.names ?? []).filter((n) => !objects.some((o) => o.name === n)), settled: true };
    },
  };
  return { reads, value };
}

function mountBlock(element: React.ReactElement, ctx: ReturnType<typeof recordingContext>, path = '/apps/crm/page/p') {
  const ds = { find: vi.fn(async () => ({ data: [] })), getObjectSchema: vi.fn(async () => OBJECTS[1]) };
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdapterCtx.Provider value={ds as never}>
        <MetadataCtx.Provider value={ctx.value as never}>
          <Routes>
            <Route path="/apps/:appName/page/:pageName" element={element} />
          </Routes>
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>
    </MemoryRouter>,
  );
}

describe('the page blocks read the objects they name, not the whole registry (objectui#12980)', () => {
  it('the interface list page reads its source object by name', () => {
    const ctx = recordingContext();
    mountBlock(<InterfaceListPage page={{ name: 'cases', label: 'Cases', interfaceConfig: { source: 'crm_case' } } as never} />, ctx);
    expect(ctx.reads.scopes).toContainEqual({ names: ['crm_case'] });
    expect(ctx.reads.objects).toBe(0);
  });

  it("nav:menu's capability gate reads the objects the app's entries require, by name", () => {
    const app = {
      name: 'crm',
      _packageId: 'app.crm',
      navigation: [
        { id: 'a', type: 'object', label: 'Accounts', objectName: 'crm_account' },
        { id: 'c', type: 'object', label: 'Cloud', objectName: 'cloud_only', requiresObject: 'cloud_only' },
      ],
    };
    const ctx = recordingContext([app]);
    mountBlock(<NavMenuRenderer />, ctx);
    expect(ctx.reads.scopes).toContainEqual({ packageId: 'app.crm', names: ['cloud_only'] });
    expect(ctx.reads.objects).toBe(0);
    // The server answered `cloud_only` without a definition: its entry is not drawn.
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('global:search reads the registry only once the user types', () => {
    const ctx = recordingContext([{ name: 'crm', _packageId: 'app.crm' }]);
    mountBlock(<GlobalSearchRenderer />, ctx);
    expect(ctx.reads.objects).toBe(0);
    expect(ctx.reads.ensured).not.toContain('object');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ac' } });
    expect(ctx.reads.ensured).toContain('object');
    expect(ctx.reads.objects).toBeGreaterThan(0);
  });
});

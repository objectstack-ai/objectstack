// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37918 — the App Studio list, as the maintainer's decision 7
 * ("List page") and decision 8 ("Read-only hint") of epic objectstack#37424
 * draw it, on the real page inside the area's host. Pinned, each with a
 * control on one of the two other hosts (Setup, and the list outside both):
 *
 *  - the title row holds the type's icon and name, "New X" and help; the
 *    toolbar a source dropdown and a search box; the breadcrumb, the stat
 *    tiles, refresh and the sort dropdown are gone, and a header click sorts;
 *  - the table is full-bleed; the name column draws the item's icon and
 *    colour, the label above the API name; a column of numbers is
 *    right-aligned; the object list has no plural label column;
 *  - "Modified at" and "Source" hide when every row says the same, and show
 *    otherwise; the badges read system-shipped / modified / new, and the
 *    source filter's two narrowings are those words — the detail's ‹ › order
 *    reads them the same way;
 *  - on a read-only base whose New creates into the `.custom` pair, New is
 *    enabled and its tooltip names the package and the pair; on a writable
 *    package New is as before, with no such tooltip.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';
import { STUDIO_MENU_TYPE_ICONS } from '../studio-design/StudioMenu';

const BASE = 'hotcrm';
const PAIR = `${BASE}.custom`;

type Item = Record<string, unknown>;
const fixture = vi.hoisted(() => ({
  items: [] as Item[],
  changedAt: {} as Record<string, string>,
  overrides: [] as Array<{ type: string; name: string }>,
}));

/** Two system-shipped objects, one the pair overrides (modified), one the pair adds (new). */
const MIXED: Item[] = [
  { name: 'crm_account', label: 'Account', icon: 'building', color: 'blue', fields: { a: {}, b: {}, c: {} }, description: 'Companies', _packageId: BASE },
  { name: 'crm_contact', label: 'Contact', pluralLabel: 'Contacts', icon: 'user', color: 'teal', fields: { a: {}, b: {} }, description: 'People', _packageId: BASE },
  { name: 'crm_lead', label: 'Lead', icon: 'filter', color: 'green', fields: { a: {} }, description: 'Prospects', _packageId: BASE },
  { name: 'crm_competitor', label: 'Competitor', pluralLabel: 'Competitors', icon: 'shield', color: 'red', fields: { a: {} }, description: 'Added here', _packageId: PAIR },
];
const MIXED_CHANGED = { crm_account: '2026-11-27T10:24:00Z', crm_competitor: '2026-11-26T16:02:00Z' };
/** Every row system-shipped, none changed. */
const ALL_SYSTEM: Item[] = MIXED.filter((i) => i._packageId === BASE);

const CLIENT = {
  list: async (type: string) => {
    if (type === 'package') return [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' } }];
    if (type === 'app') return [];
    return type === 'object' ? fixture.items : [];
  },
  listResponse: async (type: string) =>
    type === 'object' ? { items: fixture.items, changedAt: fixture.changedAt } : { items: [] },
  listDrafts: async () => [],
};

// The object type's served list layout (the spec's `METADATA_LIST_REGISTRY`).
const OBJECT_ENTRY = {
  type: 'object',
  label: 'Object',
  domain: 'data',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
  list: {
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'label', label: 'Label' },
      { field: 'pluralLabel', label: 'Plural Label' },
      { field: 'fields', label: 'Fields', type: 'count' },
      { field: 'description', label: 'Description' },
    ],
  },
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [OBJECT_ENTRY] }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataResourceListPage } from './ResourceListPage';
import { useListOrderedNames } from './useListOrderedNames';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t, tFormat, translateMetadataType } from './i18n';

registerDefaultMetadataSchemas();

const L = (key: string) => t(key, 'en-US');
const TYPE_LABEL = translateMetadataType('object', 'en-US', 'Object');

const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' }, writable: false }] } });
  }
  if (u.endsWith('/customizations')) {
    const n = fixture.overrides.length;
    return json(200, {
      success: true,
      data: {
        packageId: BASE,
        overrides: fixture.overrides,
        extensions: [],
        switchedOff: [],
        arrangements: [],
        contributions: [],
        counts: { overrides: n, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 },
      },
    });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  fixture.items = MIXED;
  fixture.changedAt = MIXED_CHANGED;
  fixture.overrides = [{ type: 'object', name: 'crm_account' }];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const READ_ONLY_BASE: MetadataAreaHost = { packageId: BASE, readOnly: true, basePath: `/studio/${BASE}/metadata`, pairCreate: true };
const WRITABLE: MetadataAreaHost = { packageId: BASE, readOnly: false, basePath: `/studio/${BASE}/metadata` };

function Location() {
  const l = useLocation();
  return <div data-testid="location">{`${l.pathname}${l.search}`}</div>;
}

/** The list in the area (a host), in Setup (`/apps/setup`), or outside both (`/apps/crm`). */
function mount(host: MetadataAreaHost | null, search = '', app = 'setup') {
  const base = host?.basePath ?? `/apps/${app}/metadata`;
  const query = host ? `?package=${host.packageId}${search}` : search ? `?${search.slice(1)}` : '';
  const tree = (
    <MemoryRouter initialEntries={[`${base}/object${query}`]}>
      <Routes>
        <Route path={host ? `${base}/:type` : '/apps/:appName/metadata/:type'} element={<MetadataResourceListPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

const rowOf = (name: string) => screen.getByTestId(`metadata-row-${name}`).closest('tr') as HTMLElement;
const rowOrder = () =>
  screen
    .getAllByTestId(/^metadata-row-(?!api-name$|source$|lock$)/)
    .map((cell) => cell.getAttribute('data-testid')!.slice('metadata-row-'.length));
const header = (name: string) => screen.queryByRole('columnheader', { name: new RegExp(`^${name}`) });
/** Every system-shipped / modified / new answer has come in: the badges are drawn. */
const settled = async () => {
  await screen.findByTestId('metadata-row-crm_account');
  await waitFor(() => expect(within(rowOf('crm_account')).getByTestId('metadata-row-source')).toHaveAttribute('data-source-kind', 'modified'));
};

describe('decision 7 — the title row and the toolbar (objectstack#37918)', () => {
  it('the title row holds the type icon, its name, "New X" and help; the toolbar a source dropdown and the search', async () => {
    mount(WRITABLE);
    await settled();
    const head = screen.getByTestId('studio-list-header');
    expect(within(head).getByTestId('studio-list-title')).toHaveTextContent(TYPE_LABEL);
    expect(within(head).getByTestId('metadata-list-create')).toHaveTextContent(
      tFormat('engine.list.createNamed', 'en-US', { type: TYPE_LABEL }),
    );
    expect(within(head).getByTestId('studio-list-help')).toBeInTheDocument();
    const toolbar = within(head).getByTestId('studio-list-toolbar');
    expect(within(toolbar).getByTestId('metadata-source-filter')).toHaveTextContent(
      tFormat('engine.list.sourceFilter.all', 'en-US', { count: 4 }),
    );
    expect(within(toolbar).getByTestId('metadata-list-search')).toBeInTheDocument();
  });

  it("the title row's icon is the Studio menu's icon for the type", async () => {
    // The lucide class that names a glyph (`lucide-table-2`), read off the menu's own icon.
    const glyphClass = (svg: Element | null) =>
      [...(svg?.classList ?? [])].filter((c) => c.startsWith('lucide-')).sort().join(' ');
    const menu = render(React.createElement(STUDIO_MENU_TYPE_ICONS.object));
    const menuGlyph = glyphClass(menu.container.querySelector('svg'));
    menu.unmount();
    expect(menuGlyph).not.toBe('');
    mount(WRITABLE);
    await settled();
    const titleIcon = screen.getByTestId('studio-list-header').querySelector('[data-studio-type-icon]');
    expect(titleIcon).toHaveAttribute('data-studio-type-icon', 'object');
    expect(glyphClass(titleIcon)).toBe(menuGlyph);
  });

  it('gone: the breadcrumb, the stat tiles, refresh, the sort dropdown and "only customizations"', async () => {
    mount(WRITABLE);
    await settled();
    expect(screen.queryByText(L('engine.breadcrumb.allTypes'))).toBeNull();
    expect(screen.queryByText(L('engine.list.items'))).toBeNull();
    expect(screen.queryByText(L('engine.list.filtered'))).toBeNull();
    expect(screen.queryByTitle(L('engine.list.refresh'))).toBeNull();
    expect(screen.queryByTestId('metadata-list-sort')).toBeNull();
    expect(screen.queryByTestId('metadata-only-customizations')).toBeNull();
  });

  it('a column header sorts: the Name header holds the default order (API name, A to Z) and a click reverses it', async () => {
    mount(WRITABLE);
    await settled();
    expect(rowOrder()).toEqual(['crm_account', 'crm_competitor', 'crm_contact', 'crm_lead']);
    fireEvent.click(header(L('engine.list.col.name'))!);
    await waitFor(() => expect(rowOrder()).toEqual(['crm_lead', 'crm_contact', 'crm_competitor', 'crm_account']));
    expect(screen.getByTestId('location')).toHaveTextContent('sort=-name');
  });

  it('CONTROL — Setup keeps its own header, with the sort dropdown and the plain "New"', async () => {
    mount(null);
    await screen.findByTestId('metadata-row-crm_account');
    expect(screen.getByTestId('metadata-list-setup-header')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-list-header')).toBeNull();
    expect(screen.getByTestId('metadata-list-sort')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-list-create')).toHaveTextContent(new RegExp(`^${L('engine.list.create')}$`));
  });

  it('CONTROL — outside Setup and the area the list keeps the shell: breadcrumb, stat tiles, refresh, sort', async () => {
    mount(null, '?package=hotcrm', 'crm');
    await screen.findByTestId('metadata-row-crm_account');
    expect(screen.getByText(L('engine.breadcrumb.allTypes'))).toBeInTheDocument();
    expect(screen.getByText(L('engine.list.items'))).toBeInTheDocument();
    expect(screen.getByTitle(L('engine.list.refresh'))).toBeInTheDocument();
    expect(screen.getByTestId('metadata-list-sort')).toBeInTheDocument();
  });
});

describe('decision 7 — the table (objectstack#37918)', () => {
  it('is full-bleed with no outer frame', async () => {
    mount(WRITABLE);
    await settled();
    const scroller = screen.getByTestId('metadata-list-scroller');
    expect(scroller.className).not.toMatch(/\brounded-lg\b/);
    expect(scroller.className).toMatch(/-mx-6/);
  });

  it("the name column draws the item's own icon and colour, the label above the API name in mono", async () => {
    mount(WRITABLE);
    await settled();
    const cell = screen.getByTestId('metadata-row-crm_account');
    expect(cell.querySelector('[data-object-icon-tile]')).toHaveAttribute('data-object-icon-tile', 'blue');
    expect(screen.getByTestId('metadata-row-crm_contact').querySelector('[data-object-icon-tile]')).toHaveAttribute(
      'data-object-icon-tile',
      'teal',
    );
    expect(within(cell).getByRole('link')).toHaveTextContent(/^Account$/);
    const api = within(cell).getByTestId('metadata-row-api-name');
    expect(api).toHaveTextContent('crm_account');
    expect(api.className).toMatch(/\bfont-mono\b/);
  });

  it('numbers are right-aligned; the object list has no plural label column', async () => {
    mount(WRITABLE);
    await settled();
    const fields = header('Fields')!;
    expect(fields).toBeInTheDocument();
    expect(fields.className).toMatch(/\btext-right\b/);
    expect(header('Description')!.className).not.toMatch(/\btext-right\b/);
    expect(header('Plural Label')).toBeNull();
    expect(screen.queryByText('Contacts')).toBeNull();
  });

  it('a description stays in the grid cell one line long, with no two-line clamp inside it', async () => {
    mount(WRITABLE);
    await settled();
    const text = within(rowOf('crm_account')).getByText('Companies');
    expect(text.closest('.line-clamp-2')).toBeNull();
    expect(text.closest('[data-slot="cell-display"]')).toHaveClass('truncate');
  });

  it('CONTROL — Setup still draws the plural label column', async () => {
    mount(null);
    await screen.findByTestId('metadata-row-crm_account');
    expect(header('Plural Label')).toBeInTheDocument();
  });
});

describe('decision 7 — "Modified at" and "Source", and the source words (objectstack#37918)', () => {
  it('a list with modified and new rows shows both columns, with 系统自带 / 已修改 / 新建 badges', async () => {
    mount(WRITABLE);
    await settled();
    expect(header(L('engine.list.col.changedAt'))).toBeInTheDocument();
    expect(header(L('engine.list.col.source'))).toBeInTheDocument();
    const badge = (name: string) => within(rowOf(name)).getByTestId('metadata-row-source');
    expect(badge('crm_account')).toHaveTextContent(L('engine.list.source.modified'));
    expect(badge('crm_competitor')).toHaveAttribute('data-source-kind', 'new');
    expect(badge('crm_competitor')).toHaveTextContent(L('engine.list.source.new'));
    expect(badge('crm_contact')).toHaveAttribute('data-source-kind', 'system');
    expect(badge('crm_contact')).toHaveTextContent(L('engine.list.source.system'));
  });

  it('an all-system-shipped list hides both: every row says the same there', async () => {
    fixture.items = ALL_SYSTEM;
    fixture.changedAt = {};
    fixture.overrides = [];
    mount(WRITABLE);
    await screen.findByTestId('metadata-row-crm_account');
    // The change-time read has answered (an empty map) before the verdict is read.
    await waitFor(() => expect(header('Fields')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(header(L('engine.list.col.changedAt'))).toBeNull();
    expect(header(L('engine.list.col.source'))).toBeNull();
    expect(screen.queryByTestId('metadata-row-source')).toBeNull();
  });

  it('"modified and new" keeps the modified and the new rows; "system-shipped" the rest — the modified row is not system-shipped', async () => {
    mount(WRITABLE, '&source=runtime');
    await screen.findByTestId('metadata-row-crm_competitor');
    await waitFor(() => expect(rowOrder()).toEqual(['crm_account', 'crm_competitor']));
    expect(screen.getByTestId('metadata-source-filter')).toHaveTextContent(
      tFormat('engine.list.sourceFilter.changed', 'en-US', { count: 2 }),
    );
    cleanup();
    mount(WRITABLE, '&source=artifact');
    await screen.findByTestId('metadata-row-crm_contact');
    await waitFor(() => expect(rowOrder()).toEqual(['crm_contact', 'crm_lead']));
  });

  it("the detail's ‹ › order reads the same words: under \"system-shipped\" it skips the modified item", async () => {
    const wrap =
      (search: string) =>
      ({ children }: { children: React.ReactNode }) => (
        <MetadataAreaHostContext.Provider value={WRITABLE}>
          <MemoryRouter initialEntries={[`/studio/${BASE}/metadata/object/crm_contact?package=${BASE}${search}`]}>
            {children}
          </MemoryRouter>
        </MetadataAreaHostContext.Provider>
      );
    const system = renderHook(() => useListOrderedNames('object'), { wrapper: wrap('&source=artifact') });
    await waitFor(() => expect(system.result.current.status).toBe('ready'));
    expect(system.result.current.names).toEqual(['crm_contact', 'crm_lead']);
    const changed = renderHook(() => useListOrderedNames('object'), { wrapper: wrap('&source=runtime') });
    await waitFor(() => expect(changed.result.current.status).toBe('ready'));
    expect(changed.result.current.names).toEqual(['crm_account', 'crm_competitor']);
  });
});

describe('decision 8 — the read-only hint on New (objectstack#37918, folding objectstack#37580)', () => {
  const hint = () =>
    tFormat('engine.list.createInPairHint', 'en-US', { package: 'HotCRM', pair: PAIR, type: TYPE_LABEL });

  it('on a read-only base with a pair, New is enabled and its tooltip names the package and the pair', async () => {
    const user = userEvent.setup();
    mount(READ_ONLY_BASE);
    await settled();
    const button = screen.getByTestId('metadata-list-create');
    expect(button).toBeEnabled();
    await user.hover(button);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(hint());
    expect(tooltip).toHaveTextContent(PAIR);
    // Read to a screen reader too: the button is described by the same words.
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(hint());
    // New still creates, into the pair: the object create dialog opens.
    fireEvent.click(button);
    expect(await screen.findByTestId('create-object-owd')).toBeInTheDocument();
  });

  it('CONTROL — on a writable package New is as today: no tooltip, and it opens the create dialog', async () => {
    const user = userEvent.setup();
    mount(WRITABLE);
    await settled();
    const button = screen.getByTestId('metadata-list-create');
    expect(button).not.toHaveAttribute('aria-describedby');
    await user.hover(button);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByTestId('create-object-owd')).toBeInTheDocument();
  });

  it('CONTROL — no per-list banner on the read-only base', async () => {
    mount(READ_ONLY_BASE);
    await settled();
    expect(screen.queryByText(L('engine.studio.pkg.readonlyHint'))).toBeNull();
    expect(screen.queryByTestId('catalog-readonly-reason')).toBeNull();
    // The hint is the button's tooltip and its description, never a line drawn over the list.
    const shown = screen.queryAllByText(hint()).filter((el) => !el.classList.contains('sr-only'));
    expect(shown).toEqual([]);
  });
});

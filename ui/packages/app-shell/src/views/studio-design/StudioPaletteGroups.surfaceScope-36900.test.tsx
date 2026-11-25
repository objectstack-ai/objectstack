// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36900 — ⌘K on a Studio design page: the palette lists that
 * page's left menu and, on a package, every item of every type it holds
 * (`StudioPaletteGroups` handed to the palette as its `surface`).
 *
 *  1. On a package: the menu's groups, in its order, under the menu's names,
 *     each with the menu's own entries and the items of its types, from the
 *     package and its `.custom` pair only, kept by the list page's own rule
 *     (its `include` and predicate); every package's objects and flows
 *     are neither read nor listed; the packages still are.
 *  2. A pick opens through the page (`surface.open`): an item at the address
 *     the one builder gives, a menu entry where the menu entry goes.
 *  3. The query matches an item by label, name or type, a menu entry by its
 *     label, type or group.
 *  4. While a list is still read, an empty result says "Searching…".
 *  5. No item list is read until the palette opens; the types come from the
 *     menu's own data (`StudioMenuDataProvider`). CONTROL: opened, it reads.
 *  6. On the cross-package leg (`~all`) the menu's environment entries join
 *     every package's objects and flows, as on the landing.
 *
 * Real subjects: `CommandPalette`, `CommandPaletteProvider` (opened by its
 * `?palette=1` deep link), `StudioPaletteGroups`, the menu model and the
 * address builder, and an `en` `I18nProvider`. The metadata reads are doubled
 * (the menu's own seam, as `StudioMenu.test.tsx` doubles them).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const reads = vi.hoisted(() => {
  const PKG = 'com.acme.crm';
  const PAIR = 'com.acme.crm.custom';
  const LISTS: Record<string, unknown[]> = {
    object: [
      { name: 'crm_account', label: 'Account', _packageId: PKG },
      { name: 'hr_employee', label: 'Employee', _packageId: 'com.acme.hr' },
    ],
    hook: [
      { name: 'on_lead_created', label: 'On lead created', _packageId: PAIR },
      // Hidden by the type's own list predicate, as its list page hides it.
      { name: 'legacy_hook', label: 'Legacy', _packageId: PKG, legacy: true },
    ],
    dashboard: [{ name: 'crm_pipeline', label: 'Pipeline', _packageId: PKG }],
    flow: [{ name: 'crm_onboard', label: 'Onboard account', _packageId: PKG }],
    permission: [{ name: 'sales_rep', label: 'Sales Rep', _packageId: PKG }],
    datasource: [{ name: 'crm_db', label: 'CRM database', _packageId: PKG }],
  };
  const state = { calls: [] as string[], options: {} as Record<string, unknown>, hold: null as Promise<void> | null };
  const client = {
    list: async (type: string, options?: unknown) => {
      state.calls.push(type);
      state.options[type] = options;
      if (state.hold) await state.hold;
      return LISTS[type] ?? [];
    },
  };
  return { PKG, PAIR, state, client };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => reads.client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'object', domain: 'data' },
        { type: 'hook', domain: 'data' },
        { type: 'datasource', domain: 'system' },
        { type: 'dashboard', domain: 'ui' },
        { type: 'flow', domain: 'automation' },
        { type: 'permission', domain: 'security' },
        { type: 'position', domain: 'security' },
        { type: 'agent', domain: 'ai' },
      ],
    }),
    useGlobalDiagnostics: () => ({
      loading: false,
      countsByType: { object: 1 },
      // The agent type is served, but this package holds none: not listed.
      packagesByType: { hook: [reads.PKG], dashboard: [reads.PKG], datasource: [reads.PKG], agent: ['com.acme.hr'] },
      reload: () => {},
    }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

// The palette reaches the record preview's `lazy()` detail entry: load it at
// module scope, so its cost is paid at import (ui/AGENTS.md, lazy boundaries).
import '@object-ui/plugin-detail';
import { CommandPalette, type StudioPaletteSurface } from '../../chrome/CommandPalette';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { StudioPaletteGroups } from './StudioPaletteGroups';
import { StudioMenuDataProvider } from './StudioMenu';
import { registerMetadataResource } from '../metadata-admin/registry';
import { studioMenuGroupLabel } from './studioMenuGroupLabel';
import { tFormat, translateMetadataType } from '../metadata-admin/i18n';

const { PKG, PAIR } = reads;

// The hook list as its list page reads it: served with an `include`, and a
// predicate that hides legacy rows.
registerMetadataResource({
  type: 'hook',
  listInclude: 'grants',
  listFilter: (item: Record<string, unknown>) => item.legacy !== true,
} as never);

/** The landing's metadata cache, counting what the cross-package lists read. */
function metadataCache() {
  const cacheReads: string[] = [];
  const value: MetadataContextValue = {
    apps: [],
    get objects() {
      cacheReads.push('object');
      return [{ name: 'hr_employee', label: 'Employee', _packageId: 'com.acme.hr' }];
    },
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => {
      cacheReads.push(type);
      return [];
    },
    getTypeStatus: () => 'ready',
  };
  return { value, cacheReads };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reads.state.calls = [];
  reads.state.options = {};
  reads.state.hold = null;
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/v1/packages')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { manifest: { id: PKG, name: 'Acme CRM' }, writable: true },
            { manifest: { id: 'com.acme.hr', name: 'People' }, writable: true },
          ],
        }),
      };
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(segment: string, opts: { at?: string; packageScope?: boolean } = {}) {
  const cache = metadataCache();
  const open = vi.fn();
  const surface: StudioPaletteSurface = {
    packageScope: opts.packageScope ?? true,
    renderGroups: (props) => <StudioPaletteGroups segment={segment} packageLabel="Acme CRM" {...props} />,
    open,
  };
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MetadataCtx.Provider value={cache.value}>
        <MemoryRouter initialEntries={[opts.at ?? `/studio/${segment}/data?palette=1`]}>
          <CommandPaletteProvider>
            <StudioMenuDataProvider segment={segment}>
              <CommandPalette scope="studio" surface={surface} />
            </StudioMenuDataProvider>
          </CommandPaletteProvider>
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  return { open, cacheReads: cache.cacheReads };
}

function type(query: string) {
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  fireEvent.change(input, { target: { value: query } });
}

/** The rendered group headings, in order. */
function headings(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((el) => (el.textContent ?? '').trim());
}

/** The cmdk value of every rendered item that starts with `prefix`. */
function values(prefix: string): string[] {
  return Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${prefix}"]`)).map(
    (el) => el.getAttribute('data-value') ?? '',
  );
}

function pick(value: string) {
  const item = document.querySelector(`[cmdk-item][data-value="${value}"]`);
  if (!item) throw new Error(`no rendered item is "${value}"`);
  fireEvent.click(item);
}

const itemsListed = () => waitFor(() => expect(values('studio-item ').length).toBeGreaterThan(0));
const group = (g: Parameters<typeof studioMenuGroupLabel>[0]) => studioMenuGroupLabel(g, 'en');

describe("on a package, the palette lists the left menu and the package's items (objectstack#36900)", () => {
  it("draws the menu's groups in its order, with the menu's entries and the items of the package and its pair", async () => {
    const { cacheReads } = mount(PKG);
    await itemsListed();

    // The menu's six groups, the empty AI one left out, then the
    // packages and the theme commands. No cross-package Objects / Flows.
    expect(headings()).toEqual([
      group('data'),
      group('ui'),
      group('automation'),
      group('system'),
      group('security'),
      'Packages',
      'Preferences',
    ]);
    expect(values('studio-entry ')).toEqual([
      'studio-entry type:object',
      'studio-entry type:hook',
      'studio-entry type:dashboard',
      'studio-entry type:flow',
      'studio-entry orgFlows',
      'studio-entry type:datasource',
      'studio-entry diagnostics',
      'studio-entry type:permission',
      'studio-entry owd',
      'studio-entry environment',
    ]);
    // Another package's object, and the datasource (Setup's), are not items.
    expect(values('studio-item ')).toEqual([
      `studio-item object ${PKG} crm_account`,
      `studio-item hook ${PAIR} on_lead_created`,
      `studio-item dashboard ${PKG} crm_pipeline`,
      `studio-item flow ${PKG} crm_onboard`,
      `studio-item permission ${PKG} sales_rep`,
    ]);
    expect(reads.state.calls).not.toContain('datasource');
    // The list page's own read and rule: its `include`, and its predicate.
    expect(reads.state.options.hook).toEqual({ include: 'grants' });
    expect(values('studio-item hook ')).toEqual([`studio-item hook ${PAIR} on_lead_created`]);
    expect(values('studio-package ')).toHaveLength(2);
    expect(values('studio-object ')).toEqual([]);
    expect(values('studio-flow ')).toEqual([]);
    expect(cacheReads).toEqual([]);
  });

  it("names an item by its label and its type, and a customization by the package's name, never the pair's id", async () => {
    mount(PKG);
    await itemsListed();
    const text = (value: string) =>
      (document.querySelector(`[cmdk-item][data-value="${value}"]`)?.textContent ?? '').trim();
    expect(text(`studio-item object ${PKG} crm_account`)).toBe(`Account${translateMetadataType('object', 'en')}`);
    expect(text(`studio-item hook ${PAIR} on_lead_created`)).toBe(
      `On lead created${translateMetadataType('hook', 'en')} · ${tFormat('engine.customizationMark.customizationOf', 'en', { baseName: 'Acme CRM' })}`,
    );
    const shownText = Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => el.textContent ?? '');
    expect(shownText.filter((x) => x.includes('.custom'))).toEqual([]);
  });

  /** Mount, pick one entry and read what the page was asked to open: a pick closes the palette. */
  async function openedBy(value: string): Promise<unknown> {
    const { open } = mount(PKG);
    await itemsListed();
    pick(value);
    const [to] = open.mock.calls.at(-1) ?? [];
    cleanup();
    return to;
  }

  it('opens an item through the page, at the address the one builder gives', async () => {
    // objectstack#36904 — the object designer's own address.
    expect(await openedBy(`studio-item object ${PKG} crm_account`)).toBe(
      '/studio/com.acme.crm/metadata/object/crm_account?package=com.acme.crm',
    );
    expect(await openedBy(`studio-item permission ${PKG} sales_rep`)).toBe(
      '/studio/com.acme.crm/access?surface=permission%3Asales_rep',
    );
    expect(await openedBy(`studio-item dashboard ${PKG} crm_pipeline`)).toBe(
      '/studio/com.acme.crm/metadata/dashboard/crm_pipeline?package=com.acme.crm',
    );
    expect(await openedBy(`studio-item hook ${PAIR} on_lead_created`)).toBe(
      '/studio/com.acme.crm/metadata/hook/on_lead_created?package=com.acme.crm.custom',
    );
  });

  it('opens a menu entry where the menu entry goes, and the palette closes', async () => {
    expect(await openedBy('studio-entry type:hook')).toBe('/studio/com.acme.crm/metadata/hook?package=com.acme.crm');
    expect(await openedBy('studio-entry orgFlows')).toBe('/studio/~org/automations');
    expect(await openedBy('studio-entry owd')).toBe('/studio/com.acme.crm/access?surface=owd%3Aoverview');
    expect(await openedBy('studio-entry diagnostics')).toBe('/studio/com.acme.crm/metadata/_diagnostics');

    mount(PKG);
    await itemsListed();
    pick('studio-entry diagnostics');
    await waitFor(() => expect(document.querySelector('[cmdk-input]')).toBeNull());
  });

  it("opens a package through the page too, and the palette's own landing navigation is not used", async () => {
    const { open } = mount(PKG);
    await itemsListed();
    pick(values('studio-package People')[0]);
    expect(open).toHaveBeenLastCalledWith('/studio/com.acme.hr/data');
  });

  it('matches an item by label, name or type, and a menu entry by label, type or group', async () => {
    mount(PKG);
    await itemsListed();

    type('pipeline');
    expect(values('studio-item ')).toEqual([`studio-item dashboard ${PKG} crm_pipeline`]);
    expect(values('studio-entry ')).toEqual([]);

    type('on_lead');
    expect(values('studio-item ')).toEqual([`studio-item hook ${PAIR} on_lead_created`]);

    type(translateMetadataType('hook', 'en'));
    expect(values('studio-entry ')).toEqual(['studio-entry type:hook']);
    expect(values('studio-item ')).toEqual([`studio-item hook ${PAIR} on_lead_created`]);

    type(group('automation'));
    expect(values('studio-entry ')).toEqual(['studio-entry type:flow', 'studio-entry orgFlows']);
    expect(headings()).toEqual([group('automation')]);
  });

  it('says "Searching…" for an empty result while a list is read, and "No results" once read', async () => {
    let release = () => {};
    reads.state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount(PKG);
    await waitFor(() => expect(reads.state.calls.length).toBeGreaterThan(0));
    type('zzzz');
    await waitFor(() => expect(document.querySelector('[cmdk-empty]')?.textContent).toContain('Searching'));
    release();
    await waitFor(() => expect(document.querySelector('[cmdk-empty]')?.textContent).toContain('No results'));
  });

  it('a query typed before the lists answer: the row that arrives is selected, and Enter opens it', async () => {
    let release = () => {};
    reads.state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { open } = mount(PKG);
    await waitFor(() => expect(reads.state.calls.length).toBeGreaterThan(0));
    // A menu entry is selected at open; the query filters it away, and the
    // row it asks for mounts only when the lists answer (cmdk selects it then).
    type('pipeline');
    expect(values('studio-item ')).toEqual([]);
    release();
    const row = `studio-item dashboard ${PKG} crm_pipeline`;
    await waitFor(() =>
      expect(document.querySelector(`[cmdk-item][data-value="${row}"]`)?.getAttribute('data-selected')).toBe('true'),
    );
    fireEvent.keyDown(document.querySelector('[cmdk-input]')!, { key: 'Enter' });
    expect(open).toHaveBeenLastCalledWith('/studio/com.acme.crm/metadata/dashboard/crm_pipeline?package=com.acme.crm');
  });

  it('reads nothing until the palette opens', async () => {
    const { cacheReads } = mount(PKG, { at: `/studio/${PKG}/data` });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[cmdk-input]')).toBeNull();
    expect(reads.state.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cacheReads).toEqual([]);
  });

  it("CONTROL — opened, it reads each listed type's list", async () => {
    mount(PKG);
    await itemsListed();
    expect([...reads.state.calls].sort()).toEqual(['dashboard', 'flow', 'hook', 'object', 'permission']);
  });
});

describe('on the cross-package leg, the menu joins every package\'s objects and flows (objectstack#36900)', () => {
  it("lists the environment menu's entries, reads no item list, and keeps the landing's groups", async () => {
    const { cacheReads } = mount('~all', { at: '/studio/~all/metadata?palette=1', packageScope: false });
    await waitFor(() => expect(values('studio-object ').length).toBeGreaterThan(0));

    expect(values('studio-entry ')).toEqual([
      'studio-entry orgFlows',
      'studio-entry type:permission',
      'studio-entry type:position',
      'studio-entry environment',
    ]);
    expect(values('studio-item ')).toEqual([]);
    expect(reads.state.calls).toEqual([]);
    expect(cacheReads).toContain('object');
    expect(cacheReads).toContain('flow');
  });
});

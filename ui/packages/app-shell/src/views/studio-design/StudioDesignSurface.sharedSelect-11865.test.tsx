// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's own pickers are the shared `Select` (objectui#11865).
 *
 * `StudioDesignSurface` drew five pickers as browser-native selects, beside
 * the shared Radix `Select` the rest of Studio picks with: the nav-item
 * inspector's *Link object*, its target picker (`NavTargetSelect`: page,
 * dashboard, report, action, component, doc page, book) and a url entry's
 * *Open in*, plus *New object*'s record sharing (OWD) and *New automation*'s
 * trigger. The card asks for one control for one kind of choice, surface by
 * surface; this suite covers those five.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows what the
 *     entry or the dialog holds, and no native select is left;
 *   - each picker keeps the accessible name the native control had (the
 *     object picker had none, and has none);
 *   - every option of every picker writes what the native control wrote:
 *     the inspector's `onNavPatch` value as JSON text plus the keys it holds
 *     as `undefined` (JSON erases those), the *New object* save and the
 *     *New automation* save as JSON text;
 *   - re-picking the current option writes nothing;
 *   - a value no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * Read-only: none of the five has such a state. A read-only package closes
 * nav editing, which unmounts the inspector
 * (`StudioDesignSurface.navEditClosesOnReadOnly-11167`, "closes nav editing
 * and the linked item’s inspector"), and offers no *New object*
 * (`StudioDesignSurface.emptyPackage`, "hides the CTA on a read-only
 * package"). The Automations rail's *New* is gated on the same `readOnly` in
 * the source; no suite pins that one.
 *
 * DIRECTION, observed against the native controls: every pin here but two
 * is red there, because each one reads a picker as the primitive's trigger
 * (the object picker by a test id the native control did not carry). The two
 * green there too pin what the conversion kept: the trigger picker's name,
 * and the record sharing default saved untouched. What makes the write pins
 * guards of "the conversion changed nothing the surface writes" is the
 * literal each compares against: a `change` event on the pre-conversion
 * surface's native control wrote that same value, read once on that
 * component with these fixtures, and so were the names. That
 * probe's `change` event fired for the current option too, which a browser's
 * native select does not do, so the re-pick rows pin the primitive. On an
 * entry whose value no option carried, the native control showed its first
 * option while the entry held the other value; the rows for that entry are
 * the writes each option's `change` made.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

type Row = { type: string; pkg: string; item: Record<string, unknown> };

const server = vi.hoisted(() => ({
  rows: [] as Array<{ type: string; pkg: string; item: Record<string, unknown> }>,
  draftHeaders: [] as Array<{ type: string; packageId: string; name: string }>,
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
}));

const mockClient = vi.hoisted(() => {
  const client: Record<string, unknown> = {
    list: vi.fn(async (type: string, options?: { packageId?: string }) =>
      server.rows
        .filter((r) => r.type === type && (!options?.packageId || r.pkg === options.packageId))
        .map((r) => JSON.parse(JSON.stringify(r.item)) as Record<string, unknown>),
    ),
    listDrafts: vi.fn(async (options?: { packageId?: string; type?: string }) =>
      server.draftHeaders
        .filter((d) => (!options?.type || d.type === options.type) && (!options?.packageId || d.packageId === options.packageId))
        .map((d) => ({ name: d.name, packageId: d.packageId })),
    ),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true, deletable: true, resettable: false, lock: 'none' })),
    getDraft: vi.fn(async (type: string, name: string) => {
      const hit = server.saves.find((s) => s.type === type && s.name === name);
      if (hit) return { item: JSON.parse(JSON.stringify(hit.body)) };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  // The flow dialog's object picker reads its catalog through the draft-aware view.
  client.withPreviewDrafts = () => client;
  return client;
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { AutomationsPillar, DataPillar, StudioNavItemInspector } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerAppComponent } from '../../services/componentRegistry';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// A screen registered with the console: what a `component` entry picks from.
registerAppComponent({ ref: 'acme:board', label: 'Acme board', component: () => null });

const en = (key: string) => t(key, 'en');

/** The nav targets the double serves: this package's, a record page and another package's page left out. */
const NAV_ROWS: Row[] = [
  { type: 'page', pkg: PKG, item: { name: 'home', label: 'Home', type: 'app' } },
  { type: 'page', pkg: PKG, item: { name: 'landing', label: 'Landing', type: 'app' } },
  { type: 'page', pkg: PKG, item: { name: 'task_detail', label: 'Task detail', type: 'record' } },
  { type: 'page', pkg: 'com.other.app', item: { name: 'foreign_page', label: 'Foreign', type: 'app' } },
  { type: 'dashboard', pkg: PKG, item: { name: 'ops_board', label: 'Operations' } },
  { type: 'report', pkg: PKG, item: { name: 'tasks_by_status', label: 'Tasks by status' } },
  { type: 'action', pkg: PKG, item: { name: 'sync_all', label: 'Sync all' } },
  { type: 'action', pkg: PKG, item: { name: 'close_task', label: 'Close task', objectName: 'acme_task' } },
  { type: 'doc', pkg: PKG, item: { name: 'getting_started', label: 'Getting started' } },
  { type: 'book', pkg: PKG, item: { name: 'acme_manual', label: 'Acme manual' } },
];

beforeEach(() => {
  server.rows = NAV_ROWS.map((r) => JSON.parse(JSON.stringify(r)) as Row);
  server.draftHeaders = [{ type: 'page', packageId: PKG, name: 'draft_page' }];
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as { mockClear?: () => void }).mockClear?.();
  // No read here goes out over the global `fetch`; one double answers "absent".
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The object picker's handle: it has no accessible name, as the native control had none. */
const OBJECT_PICKER = 'nav-link-object';
const CHOOSE_OBJECT = en('engine.studio.nav.chooseObject');
const CHOOSE = en('engine.inspector.appNav.choose');
const SAME_TAB = en('engine.inspector.appNav.urlTargetSelf');
const NEW_TAB = en('engine.inspector.appNav.urlTargetBlank');

/** A picker by its accessible name, or the object picker by its test id. */
function picker(handle: string): HTMLElement {
  return handle === OBJECT_PICKER ? screen.getByTestId(OBJECT_PICKER) : screen.getByRole('combobox', { name: handle });
}

/** Open a picker from the keyboard and return its listbox. */
async function openList(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

/** The options an open picker lists, in order, once `waitFor` is among them. */
async function listed(trigger: HTMLElement, waitFor?: string): Promise<string[]> {
  const listbox = await openList(trigger);
  if (waitFor) await within(listbox).findByRole('option', { name: waitFor }, { timeout: 8000 });
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

/** Pick the option labelled `label`, waiting for a package list to offer it. */
async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const listbox = await openList(trigger);
  fireEvent.click(await within(listbox).findByRole('option', { name: label }, { timeout: 8000 }));
}

// ---------------------------------------------------------------------------
// The nav-item inspector: Link object, the target pickers and Open in
// ---------------------------------------------------------------------------

const OBJECTS = [
  { name: 'crm_lead', label: 'Leads' },
  { name: 'legacy_lead', label: 'Legacy Leads' },
];

const ENTRIES: Record<string, Record<string, unknown>> = {
  objBorn: { id: 'nav_item_3', type: 'object' },
  objBound: { id: 'nav_lead', type: 'object', objectName: 'crm_lead', label: 'Leads' },
  objUntyped: { id: 'nav_x', label: 'X' },
  objOutside: { id: 'nav_g', type: 'object', objectName: 'ghost_obj' },
  objNoId: { type: 'object' },
  pageBorn: { id: 'nav_item_3', type: 'page' },
  pageBound: { id: 'nav_p', type: 'page', pageName: 'home', label: 'Home menu' },
  pageOutside: { id: 'nav_p', type: 'page', pageName: 'ghost_page' },
  dashBound: { id: 'nav_d', type: 'dashboard', dashboardName: 'ops_board' },
  reportBorn: { id: 'nav_item_3', type: 'report' },
  actionBorn: { id: 'nav_item_3', type: 'action' },
  actionBound: { id: 'nav_a', type: 'action', actionDef: { actionName: 'sync_all' } },
  compBorn: { id: 'nav_item_3', type: 'component' },
  docBorn: { id: 'nav_item_3', type: 'doc' },
  docBound: { id: 'nav_doc', type: 'doc', doc: 'getting_started', book: 'acme_manual' },
  urlDefault: { id: 'nav_u', type: 'url', url: 'https://example.com' },
  urlBlank: { id: 'nav_u', type: 'url', url: 'https://example.com', target: '_blank' },
  urlOutside: { id: 'nav_u', type: 'url', url: 'https://example.com', target: '_top' },
};

function renderEntry(key: string) {
  const onNavPatch = vi.fn();
  const utils = render(
    <StudioNavItemInspector
      navId="navigation[0]"
      appDraft={{ navigation: [ENTRIES[key]] }}
      objects={OBJECTS}
      packageId={PKG}
      onNavPatch={onNavPatch}
      onClear={() => undefined}
    />,
  );
  return { ...utils, onNavPatch };
}

/**
 * [entry, picker, option label, the JSON text of the value `onNavPatch`
 * received, the keys the written entry holds as `undefined`]. `null`: nothing
 * is written — the option is the current one.
 */
const NAV_WRITES: ReadonlyArray<readonly [string, string, string, string | null, readonly string[]]> = [
  ['objBorn', OBJECT_PICKER, CHOOSE_OBJECT, null, []],
  ['objBorn', OBJECT_PICKER, 'Leads (crm_lead)', '{"navigation":[{"id":"nav_item_3","type":"object","objectName":"crm_lead"}]}', ['object','path']],
  ['objBorn', OBJECT_PICKER, 'Legacy Leads (legacy_lead)', '{"navigation":[{"id":"nav_item_3","type":"object","objectName":"legacy_lead"}]}', ['object','path']],
  ['objBound', OBJECT_PICKER, CHOOSE_OBJECT, '{"navigation":[{"id":"nav_lead","label":"Leads"}]}', ['type','objectName','object']],
  ['objBound', OBJECT_PICKER, 'Leads (crm_lead)', null, []],
  ['objBound', OBJECT_PICKER, 'Legacy Leads (legacy_lead)', '{"navigation":[{"id":"nav_lead","type":"object","objectName":"legacy_lead","label":"Leads"}]}', ['object','path']],
  ['objUntyped', OBJECT_PICKER, CHOOSE_OBJECT, null, []],
  ['objUntyped', OBJECT_PICKER, 'Leads (crm_lead)', '{"navigation":[{"id":"nav_x","label":"X","type":"object","objectName":"crm_lead"}]}', ['object','path']],
  ['objUntyped', OBJECT_PICKER, 'Legacy Leads (legacy_lead)', '{"navigation":[{"id":"nav_x","label":"X","type":"object","objectName":"legacy_lead"}]}', ['object','path']],
  ['objOutside', OBJECT_PICKER, CHOOSE_OBJECT, '{"navigation":[{"id":"nav_g"}]}', ['type','objectName','object']],
  ['objOutside', OBJECT_PICKER, 'Leads (crm_lead)', '{"navigation":[{"id":"nav_g","type":"object","objectName":"crm_lead"}]}', ['object','path']],
  ['objOutside', OBJECT_PICKER, 'Legacy Leads (legacy_lead)', '{"navigation":[{"id":"nav_g","type":"object","objectName":"legacy_lead"}]}', ['object','path']],
  ['objNoId', OBJECT_PICKER, CHOOSE_OBJECT, null, []],
  ['objNoId', OBJECT_PICKER, 'Leads (crm_lead)', '{"navigation":[{"type":"object","id":"nav_crm_lead","objectName":"crm_lead"}]}', ['object','path']],
  ['objNoId', OBJECT_PICKER, 'Legacy Leads (legacy_lead)', '{"navigation":[{"type":"object","id":"nav_legacy_lead","objectName":"legacy_lead"}]}', ['object','path']],
  ['pageBorn', 'Page', CHOOSE, null, []],
  ['pageBorn', 'Page', 'Home (home)', '{"navigation":[{"id":"nav_item_3","type":"page","pageName":"home"}]}', []],
  ['pageBorn', 'Page', 'Landing (landing)', '{"navigation":[{"id":"nav_item_3","type":"page","pageName":"landing"}]}', []],
  ['pageBorn', 'Page', 'draft_page', '{"navigation":[{"id":"nav_item_3","type":"page","pageName":"draft_page"}]}', []],
  ['pageBound', 'Page', CHOOSE, '{"navigation":[{"id":"nav_p","type":"page","label":"Home menu"}]}', []],
  ['pageBound', 'Page', 'Home (home)', null, []],
  ['pageBound', 'Page', 'Landing (landing)', '{"navigation":[{"id":"nav_p","type":"page","pageName":"landing","label":"Home menu"}]}', []],
  ['pageBound', 'Page', 'draft_page', '{"navigation":[{"id":"nav_p","type":"page","pageName":"draft_page","label":"Home menu"}]}', []],
  ['pageOutside', 'Page', CHOOSE, '{"navigation":[{"id":"nav_p","type":"page"}]}', []],
  ['pageOutside', 'Page', 'ghost_page', null, []],
  ['pageOutside', 'Page', 'Home (home)', '{"navigation":[{"id":"nav_p","type":"page","pageName":"home"}]}', []],
  ['pageOutside', 'Page', 'Landing (landing)', '{"navigation":[{"id":"nav_p","type":"page","pageName":"landing"}]}', []],
  ['pageOutside', 'Page', 'draft_page', '{"navigation":[{"id":"nav_p","type":"page","pageName":"draft_page"}]}', []],
  ['dashBound', 'Dashboard', CHOOSE, '{"navigation":[{"id":"nav_d","type":"dashboard"}]}', []],
  ['dashBound', 'Dashboard', 'Operations (ops_board)', null, []],
  ['reportBorn', 'Report', CHOOSE, null, []],
  ['reportBorn', 'Report', 'Tasks by status (tasks_by_status)', '{"navigation":[{"id":"nav_item_3","type":"report","reportName":"tasks_by_status"}]}', []],
  ['actionBorn', 'Action', CHOOSE, null, []],
  ['actionBorn', 'Action', 'Sync all (sync_all)', '{"navigation":[{"id":"nav_item_3","type":"action","actionDef":{"actionName":"sync_all"}}]}', []],
  ['actionBound', 'Action', CHOOSE, '{"navigation":[{"id":"nav_a","type":"action"}]}', []],
  ['actionBound', 'Action', 'Sync all (sync_all)', null, []],
  ['compBorn', 'Component', CHOOSE, null, []],
  ['compBorn', 'Component', 'Acme board (acme:board)', '{"navigation":[{"id":"nav_item_3","type":"component","componentRef":"acme:board"}]}', []],
  ['docBorn', 'Doc page', CHOOSE, null, []],
  ['docBorn', 'Doc page', 'Getting started (getting_started)', '{"navigation":[{"id":"nav_item_3","type":"doc","doc":"getting_started"}]}', []],
  ['docBorn', 'Book', CHOOSE, null, []],
  ['docBorn', 'Book', 'Acme manual (acme_manual)', '{"navigation":[{"id":"nav_item_3","type":"doc","book":"acme_manual"}]}', []],
  ['docBound', 'Doc page', CHOOSE, '{"navigation":[{"id":"nav_doc","type":"doc","book":"acme_manual"}]}', []],
  ['docBound', 'Doc page', 'Getting started (getting_started)', null, []],
  ['docBound', 'Book', CHOOSE, '{"navigation":[{"id":"nav_doc","type":"doc","doc":"getting_started"}]}', []],
  ['docBound', 'Book', 'Acme manual (acme_manual)', null, []],
  ['urlDefault', 'Open in', SAME_TAB, null, []],
  ['urlDefault', 'Open in', NEW_TAB, '{"navigation":[{"id":"nav_u","type":"url","url":"https://example.com","target":"_blank"}]}', []],
  ['urlBlank', 'Open in', SAME_TAB, '{"navigation":[{"id":"nav_u","type":"url","url":"https://example.com","target":"_self"}]}', []],
  ['urlBlank', 'Open in', NEW_TAB, null, []],
  ['urlOutside', 'Open in', SAME_TAB, '{"navigation":[{"id":"nav_u","type":"url","url":"https://example.com","target":"_self"}]}', []],
  ['urlOutside', 'Open in', NEW_TAB, '{"navigation":[{"id":"nav_u","type":"url","url":"https://example.com","target":"_blank"}]}', []],
];

function expectNavWrote(onNavPatch: ReturnType<typeof vi.fn>, json: string | null, undefinedKeys: readonly string[]): void {
  if (json === null) {
    expect(onNavPatch).not.toHaveBeenCalled();
    return;
  }
  expect(onNavPatch).toHaveBeenCalledTimes(1);
  const patch = onNavPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> };
  expect(JSON.stringify(patch)).toBe(json);
  const entry = patch.navigation[0];
  expect(Object.keys(entry).filter((k) => entry[k] === undefined)).toEqual(undefinedKeys);
}

describe('the nav-item inspector picks with the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the entry’s value', async () => {
    const shown: Record<string, string> = {};
    for (const [key, handle, loaded] of [
      ['objBorn', OBJECT_PICKER, undefined],
      ['objBound', OBJECT_PICKER, undefined],
      ['pageBound', 'Page', 'Home (home)'],
      ['urlDefault', 'Open in', undefined],
      ['urlBlank', 'Open in', undefined],
    ] as const) {
      const { container } = renderEntry(key);
      expect(container.querySelector('select'), key).toBeNull();
      const trigger = picker(handle);
      expect(trigger.tagName, key).toBe('BUTTON');
      expect(trigger, key).toHaveAttribute('role', 'combobox');
      if (loaded) await waitFor_(() => expect(trigger).toHaveTextContent(loaded));
      shown[key] = trigger.textContent ?? '';
      cleanup();
    }
    expect(shown).toEqual({
      objBorn: CHOOSE_OBJECT,
      objBound: 'Leads (crm_lead)',
      pageBound: 'Home (home)',
      urlDefault: SAME_TAB,
      urlBlank: NEW_TAB,
    });
  });

  // The names were read on the native controls; red there only because the object picker is found by its test id.
  it('each picker keeps the name its label gave the native control; the object picker had none', async () => {
    const names: Record<string, string[]> = {};
    for (const key of ['objBorn', 'pageBorn', 'dashBound', 'reportBorn', 'actionBorn', 'compBorn', 'docBorn', 'urlDefault']) {
      renderEntry(key);
      names[key] = screen.getAllByRole('combobox').map((c) => {
        // objectui#12455 — the inspector's Icon picker is a combobox named by its label too.
        const named = ['Page', 'Dashboard', 'Report', 'Action', 'Component', 'Doc page', 'Book', 'Open in', 'Icon'].find(
          (n) => screen.queryByRole('combobox', { name: n }) === c,
        );
        return named ?? '';
      });
      cleanup();
    }
    expect(names).toEqual({
      objBorn: ['', 'Icon'],
      pageBorn: ['Page', 'Icon'],
      dashBound: ['Dashboard', 'Icon'],
      reportBorn: ['Report', 'Icon'],
      actionBorn: ['Action', 'Icon'],
      compBorn: ['Component', 'Icon'],
      docBorn: ['Doc page', 'Book', 'Icon'],
      urlDefault: ['Open in', 'Icon'],
    });
    renderEntry('objBorn');
    expect(screen.getByTestId(OBJECT_PICKER)).not.toHaveAccessibleName();
  });

  it('each picker lists its options in the order the native control did', async () => {
    renderEntry('objBound');
    expect(await listed(picker(OBJECT_PICKER))).toEqual([CHOOSE_OBJECT, 'Leads (crm_lead)', 'Legacy Leads (legacy_lead)']);
    cleanup();

    renderEntry('pageBorn');
    expect(await listed(picker('Page'), 'Home (home)')).toEqual([CHOOSE, 'Home (home)', 'Landing (landing)', 'draft_page']);
    cleanup();

    renderEntry('actionBorn');
    expect(await listed(picker('Action'), 'Sync all (sync_all)')).toEqual([CHOOSE, 'Sync all (sync_all)']);
    cleanup();

    renderEntry('compBorn');
    expect(await listed(picker('Component'))).toEqual([CHOOSE, 'Acme board (acme:board)']);
    cleanup();

    renderEntry('urlDefault');
    expect(await listed(picker('Open in'))).toEqual([SAME_TAB, NEW_TAB]);
  });

  it.each(NAV_WRITES.map((row) => [`${row[0]}: ${row[1] === OBJECT_PICKER ? 'Link object' : row[1]} → ${row[2]}`, ...row] as const))(
    '%s',
    async (_name, key, handle, label, json, undefinedKeys) => {
      const { onNavPatch } = renderEntry(key);
      await pick(picker(handle), label);
      expectNavWrote(onNavPatch, json, undefinedKeys);
    },
  );
});

describe('a value no option carries is what the nav picker shows', () => {
  it('an object the package does not offer: shown and listed first, and re-picking it writes nothing', async () => {
    const { onNavPatch } = renderEntry('objOutside');
    // The native control showed "— Choose object —" here, as if the entry were unbound.
    expect(picker(OBJECT_PICKER).textContent).toBe('ghost_obj');
    expect(await listed(picker(OBJECT_PICKER))).toEqual(['ghost_obj', CHOOSE_OBJECT, 'Leads (crm_lead)', 'Legacy Leads (legacy_lead)']);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onNavPatch).not.toHaveBeenCalled();
  });

  it('an Open in the picker does not offer is shown, not "Same tab"', async () => {
    const { onNavPatch } = renderEntry('urlOutside');
    expect(picker('Open in').textContent).toBe('_top');
    expect(await listed(picker('Open in'))).toEqual(['_top', SAME_TAB, NEW_TAB]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onNavPatch).not.toHaveBeenCalled();
  });

  it('a target the package does not list is shown, as the native control showed it, and listed after Choose', async () => {
    renderEntry('pageOutside');
    expect(picker('Page').textContent).toBe('ghost_page');
    expect(await listed(picker('Page'), 'Home (home)')).toEqual([CHOOSE, 'ghost_page', 'Home (home)', 'Landing (landing)', 'draft_page']);
  });

  it('while the package list loads, a bound target shows its own name, as the native control did', () => {
    renderEntry('pageBound');
    expect(picker('Page').textContent).toBe('home');
  });
});

describe('the keyboard alone picks in the nav inspector', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onNavPatch } = renderEntry('objBorn');
    fireEvent.keyDown(picker(OBJECT_PICKER), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Leads (crm_lead)' }), { key: 'Enter' });
    expectNavWrote(
      onNavPatch,
      '{"navigation":[{"id":"nav_item_3","type":"object","objectName":"crm_lead"}]}',
      ['object', 'path'],
    );
  });
});

// ---------------------------------------------------------------------------
// New object: record sharing (OWD)
// ---------------------------------------------------------------------------

const OWD_PRIVATE = en('engine.studio.settings.sharingPrivate');
const OWD_PUBLIC_READ = en('engine.studio.settings.sharingPublicRead');
const OWD_PUBLIC_READ_WRITE = en('engine.studio.settings.sharingPublicReadWrite');

/** The name the native control had: its wrapping label's whole text, the gloss of the chosen model included. */
const owdName = (descKey: string) =>
  `${en('engine.studio.data.owdLabel')} ${en(descKey)} ${en('engine.studio.data.owdHint')}`;

/** The package the base reading of these saves was taken in. */
const OBJECT_PKG = 'com.test.crmext';

async function openNewObject(): Promise<HTMLElement> {
  // An empty package: the pillar offers *New object* from its empty state.
  server.rows = [];
  render(
    <MemoryRouter initialEntries={[`/studio/${OBJECT_PKG}/data`]}>
      <DataPillar packageId={OBJECT_PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('empty-state-new-object', undefined, { timeout: 8000 }));
  return await screen.findByTestId('create-object-owd');
}

/** Name the object, submit, and return the JSON text of the one save call. */
async function submitObject(): Promise<string> {
  const dialog = screen.getByRole('dialog');
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Visit' } });
  fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createDraft') }));
  await waitFor_(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
  return JSON.stringify((mockClient.save as ReturnType<typeof vi.fn>).mock.calls[0]);
}

/**
 * [option label, the JSON text of the save the create made]. The create is the
 * first-write pin, `ifNoneMatch: '*'` (objectui#11773).
 */
const OWD_WRITES: ReadonlyArray<readonly [string, string]> = [
  [OWD_PRIVATE, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"private","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
  [OWD_PUBLIC_READ, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"public_read","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
  [OWD_PUBLIC_READ_WRITE, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"public_read_write","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
];

describe('New object picks its record sharing with the shared Select (objectui#11865)', () => {
  it('the picker is the Radix combobox trigger, on the recommended default, and no native select is left', async () => {
    const trigger = await openNewObject();
    expect(screen.getByRole('dialog').querySelector('select')).toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe(OWD_PRIVATE);
    expect(await listed(trigger)).toEqual([OWD_PRIVATE, OWD_PUBLIC_READ, OWD_PUBLIC_READ_WRITE]);
  });

  // The two names were read on the native control; red there only because the second is read after a pick in the list.
  it('keeps the name its wrapping label gave the native control, the chosen model’s gloss included', async () => {
    const trigger = await openNewObject();
    expect(trigger).toHaveAccessibleName(owdName('engine.studio.settings.sharingDescPrivate'));
    await pick(trigger, OWD_PUBLIC_READ);
    expect(screen.getByTestId('create-object-owd')).toHaveAccessibleName(owdName('engine.studio.settings.sharingDescPublicRead'));
  });

  it.each(OWD_WRITES.map((row) => [`→ ${row[0]}`, ...row] as const))('%s', async (_name, label, json) => {
    const trigger = await openNewObject();
    await pick(trigger, label);
    expect(await submitObject()).toBe(json);
  });

  it('left untouched, the default is saved, as before', async () => {
    await openNewObject();
    expect(await submitObject()).toBe(OWD_WRITES[0][1]);
  });
});

// ---------------------------------------------------------------------------
// New automation: the trigger, under Advanced
// ---------------------------------------------------------------------------

const LATER = en('engine.studio.newAutoTrigger.later');

async function openNewFlow(): Promise<HTMLElement> {
  server.rows = [{ type: 'object', pkg: PKG, item: { name: 'ticket', label: 'Ticket' } }];
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTitle(en('engine.studio.auto.newTitle'), undefined, { timeout: 8000 }));
  fireEvent.change(await screen.findByPlaceholderText(en('engine.studio.auto.namePlaceholder')), {
    target: { value: 'Probe' },
  });
  fireEvent.click(screen.getByRole('radio', { name: en('engine.studio.rules.advanced') }));
  return screen.getByTestId('create-flow-trigger');
}

/** Submit and return the JSON text of the saved flow. */
async function submitFlow(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: en('engine.studio.createDraft') }));
  await waitFor_(() => expect(server.saves).toHaveLength(1));
  return JSON.stringify(server.saves[0].body);
}

const flowWith = (config: string) =>
  `{"name":"probe","label":"Probe","type":"autolaunched","nodes":[{"id":"start","type":"start","label":"Start"${config}},{"id":"end","type":"end","label":"End"}],"edges":[{"id":"e1","source":"start","target":"end"}],"status":"obsolete"}`;

/** [option label, the JSON text of the flow the create saved, no object named]. */
const TRIGGER_WRITES: ReadonlyArray<readonly [string, string]> = [
  [LATER, flowWith('')],
  ['Record created', flowWith(',"config":{"triggerType":"record-after-create"}')],
  ['Record updated', flowWith(',"config":{"triggerType":"record-after-update"}')],
  ['Record created or updated', flowWith(',"config":{"triggerType":"record-after-write"}')],
  ['Record before update', flowWith(',"config":{"triggerType":"record-before-update"}')],
  ['Record deleted', flowWith(',"config":{"triggerType":"record-after-delete"}')],
  ['Schedule', flowWith(',"config":{"triggerType":"schedule"}')],
  ['Time-relative (date sweep)', flowWith(',"config":{"triggerType":"time_relative"}')],
  ['Manual / autolaunched', flowWith(',"config":{"triggerType":"manual"}')],
  ['Webhook / API', flowWith(',"config":{"triggerType":"api"}')],
];

describe('New automation picks its trigger with the shared Select (objectui#11865)', () => {
  it('the picker is the Radix combobox trigger, on "choose later", and no native select is left', async () => {
    const trigger = await openNewFlow();
    expect(screen.getByRole('dialog').querySelector('select')).toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe(LATER);
    expect(await listed(trigger)).toEqual(TRIGGER_WRITES.map((row) => row[0]));
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name its wrapping label gave the native control', async () => {
    const trigger = await openNewFlow();
    expect(screen.getByRole('combobox', { name: 'Trigger' })).toBe(trigger);
  });

  it.each(TRIGGER_WRITES.map((row) => [`→ ${row[0]}`, ...row] as const))('%s', async (_name, label, json) => {
    const trigger = await openNewFlow();
    await pick(trigger, label);
    expect(await submitFlow()).toBe(json);
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    const trigger = await openNewFlow();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Manual / autolaunched' }), { key: 'Enter' });
    expect(await submitFlow()).toBe(flowWith(',"config":{"triggerType":"manual"}'));
  });
});

/** `waitFor` with the slow-box budget this file's other waits use. */
function waitFor_(assertion: () => void): Promise<void> {
  return waitFor(assertion, { timeout: 8000 });
}

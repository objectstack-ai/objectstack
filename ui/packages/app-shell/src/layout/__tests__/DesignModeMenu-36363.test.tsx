// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's menu under the design mode (objectstack#36363), drawn by its
 * editor under the shell's mode and saved through the mode's 「Save」.
 *
 * Real subjects: `DesignModeMenu`, `useDesignModeController`,
 * `DesignModeProvider`, `DesignModeBar`, `saveAppMenu`. The metadata client
 * and the package doors are fakes that record what is written; the
 * deployment's languages (`GET /api/v1/i18n/locales`) are a stubbed fetch.
 * `DndContext` is the real one, its `onDragStart` and `onDragEnd` kept so
 * that a drag can be played without the pointer geometry jsdom does not have.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

const session = vi.hoisted(() => ({ language: 'en', defaultLocale: 'en' }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: session.language,
  }),
}));

const dragEnd = vi.hoisted(() => ({ current: null as null | ((event: unknown) => void) }));
const dragStart = vi.hoisted(() => ({ current: null as null | ((event: unknown) => void) }));
/** objectstack#36538 — the editor's cancel handler, its collision rule, and every drag start dnd-kit itself reported. */
const dragCancel = vi.hoisted(() => ({ current: null as null | ((event: unknown) => void) }));
const collisionRule = vi.hoisted(() => ({ current: null as null | ((args: unknown) => unknown[]) }));
const dragStarts = vi.hoisted(() => [] as unknown[]);
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DndContext: (props: React.ComponentProps<typeof real.DndContext>) => {
      dragEnd.current = props.onDragEnd as never;
      dragStart.current = props.onDragStart as never;
      dragCancel.current = props.onDragCancel as never;
      collisionRule.current = props.collisionDetection as never;
      const onDragStart: typeof props.onDragStart = (event) => {
        dragStarts.push(event);
        props.onDragStart?.(event);
      };
      return createElement(real.DndContext, { ...props, onDragStart });
    },
  };
});

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: toastError, success: vi.fn() },
}));

const written = vi.hoisted(() => [] as Array<[string, ...unknown[]]>);
const listed = vi.hoisted(() => ({
  object: [
    { name: 'crm_lead', label: 'Leads' },
    { name: 'crm_account', label: 'Accounts' },
    { name: 'crm_case', label: 'Cases' },
  ],
  view: [{ name: 'crm_lead.hot', label: 'Hot leads' }],
  dashboard: [],
  report: [{ name: 'pipeline', label: 'Pipeline' }],
  page: [
    { name: 'welcome', label: 'Welcome' },
    { name: 'crm_lead_record', label: 'Lead record', type: 'record' },
  ],
}) as Record<string, Array<Record<string, unknown>>>);
/** objectstack#36364 — names the server holds (`type/name`), and a refusal of the app's save. */
const server = vi.hoisted(() => ({ held: new Set<string>(), appSave: null as Error | null, appPublish: null as Error | null }));
/** The app's menu as served (`null`: `NAVIGATION`). */
const servedNav = vi.hoisted(() => ({ current: null as unknown[] | null }));
/**
 * The app's menu as stored (`null`: as served). objectstack#36538: `missing`
 * answers every layered read as `MetadataClient.layered` answers a 404;
 * `gate` holds the next read until it settles; `overlayVersion` is served
 * when set.
 */
const storedNav = vi.hoisted(() => ({
  current: null as unknown[] | null,
  failReads: 0,
  missing: false,
  gate: null as Promise<void> | null,
  overlayVersion: undefined as string | undefined,
}));
const client = vi.hoisted(() => ({
  list: async (type: string) => listed[type] ?? [],
  layered: async () => {
    const gate = storedNav.gate;
    storedNav.gate = null;
    if (gate) await gate;
    if (storedNav.failReads > 0) {
      storedNav.failReads -= 1;
      throw new Error('layered read failed');
    }
    if (storedNav.missing) return { code: null, overlay: null, overlayScope: null, effective: null };
    const code = { name: 'crm', label: 'CRM', navigation: storedNav.current ?? servedNav.current ?? NAVIGATION };
    return { code, effective: code, ...(storedNav.overlayVersion ? { overlayVersion: storedNav.overlayVersion } : {}) };
  },
  get: async (type: string, name: string) => (server.held.has(`${type}/${name}`) ? { name } : null),
  save: async (...args: unknown[]) => {
    written.push(['save', ...args]);
    if (args[0] === 'app' && server.appSave) throw server.appSave;
    return {};
  },
  publish: async (...args: unknown[]) => {
    written.push(['publish', ...args]);
    if (args[0] === 'app' && server.appPublish) throw server.appPublish;
    return {};
  },
  reset: async (...args: unknown[]) => {
    written.push(['reset', ...args]);
    return {};
  },
}));
vi.mock('../../views/metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('../../views/studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () =>
    new Map([['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: true, manifest: { version: '1.0.0' } }]]),
  ensureCustomizationPackage: async () => {
    throw new Error('not expected');
  },
}));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

import { DesignModeProvider, useDesignMode, useDesignModeController } from '../designMode';
import { DesignModeBar } from '../DesignModeBar';
import DesignModeMenu from '../DesignModeMenu';
import { closestCenter, type CollisionDetection } from '@dnd-kit/core';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';
import { __resetDefaultLocale } from '../designModeMenuSave';

const NAVIGATION = [
  { id: 'home', type: 'report', reportName: 'pipeline', label: 'Home' },
  {
    id: 'sales',
    type: 'group',
    label: 'Sales',
    children: [
      { id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
      { id: 'accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    ],
  },
  { id: 'insights', type: 'group', label: 'Insights', children: [] },
];

/** The console's answer for an entry without a label: its object's label. */
const OBJECT_LABELS: Record<string, string> = { crm_lead: 'Leads', crm_account: 'Accounts', crm_case: 'Cases' };

function Harness() {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active && <DesignModeBar mode={mode} />}
      <Enter />
      <SwitchApp />
      <SidebarProvider>
        {mode.active && (
          <DesignModeMenu
            app={{ name: 'crm', navigation: servedNav.current ?? NAVIGATION, _packageId: 'com.acme.crm' }}
            basePath="/apps/crm"
            resolveTargetLabel={(target) => (target.kind === 'object' ? OBJECT_LABELS[target.objectName] : undefined)}
          />
        )}
      </SidebarProvider>
    </DesignModeProvider>
  );
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function Enter() {
  const mode = useDesignMode();
  return (
    <button type="button" onClick={mode?.enter}>
      enter
    </button>
  );
}

/** The app menu's switch, as the sidebar wires it: `confirmUnsavedLeave` around the change of app. */
const switchedTo = vi.hoisted(() => [] as string[]);
function SwitchApp() {
  return (
    <button type="button" onClick={() => confirmUnsavedLeave(() => switchedTo.push('hr'))}>
      switch to hr
    </button>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const entry = (id: string) => screen.getByTestId(`design-menu-entry-${id}`);
/** The link the entry `id` is drawn as (dnd-kit gives it the role of a button). */
const linkOf = (id: string) => entry(id).querySelector('a')!;
/** The entries of the group `id` (the top level for `null`), in order. */
function order(): unknown[] {
  const list = screen.getByTestId('design-mode-menu').querySelector('ul')!;
  const read = (ul: Element): unknown[] =>
    [...ul.children].flatMap((li): unknown[] => {
      const testid = li.getAttribute('data-testid') ?? '';
      if (testid.startsWith('design-menu-entry-')) return [testid.slice('design-menu-entry-'.length)];
      if (testid.startsWith('design-menu-group-')) return [[testid.slice('design-menu-group-'.length), read(li.querySelector('ul')!)]];
      if (testid === 'design-menu-placeholder') return ['…'];
      return [];
    });
  return read(list);
}

/** Opens the 「⋮」 menu of the entry `id` and picks `item`. */
async function act_on(id: string, item: string) {
  const trigger = within(entry(id)).getByTestId('design-menu-actions');
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  await flush();
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  await flush();
}

beforeEach(() => {
  written.length = 0;
  switchedTo.length = 0;
  toastError.mockReset();
  session.language = 'en';
  session.defaultLocale = 'en';
  storedNav.current = null;
  storedNav.failReads = 0;
  storedNav.missing = false;
  storedNav.gate = null;
  storedNav.overlayVersion = undefined;
  dragStarts.length = 0;
  server.held.clear();
  server.appSave = null;
  server.appPublish = null;
  servedNav.current = null;
  __resetDefaultLocale();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/i18n/locales')) {
        const locales = ['en', 'zh-CN'].map((code) => ({ code, label: code, isDefault: code === session.defaultLocale }));
        return new Response(JSON.stringify({ success: true, data: { locales } }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function start() {
  render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <Harness />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('enter'));
}

describe('the menu under the design mode (objectstack#36363)', () => {
  it('each group and the top level end with 「Add menu item」; each entry has a 「⋮」 menu', () => {
    start();
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
    for (const at of ['sales', 'insights', 'top']) expect(screen.getByTestId(`design-menu-add-${at}`)).toHaveTextContent('Add menu item');
    expect(within(entry('leads')).getByRole('button', { name: 'Actions for Leads' })).toBeInTheDocument();
  });

  it('「⋮ → Move up」 is staged, and 「Save」 writes the app with the new menu and publishes it', async () => {
    start();
    await act_on('accounts', 'Move up');
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', []]]);
    expect(written).toEqual([]);

    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const [save, publish] = written;
    expect(save[0]).toBe('save');
    expect((save[3] as { navigation: Array<{ children?: Array<{ id: string }> }> }).navigation[1].children!.map((c) => c.id)).toEqual([
      'accounts',
      'leads',
    ]);
    expect(save[4]).toEqual({ mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' });
    expect(publish).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm' }]);
    expect(screen.queryByTestId('design-mode-bar')).toBeNull();
  });

  it('「Move to group」 lists the other groups and moves the entry to the end of the one picked', async () => {
    start();
    const trigger = within(entry('leads')).getByTestId('design-menu-actions');
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await flush();
    const sub = await screen.findByRole('menuitem', { name: 'Move to group' });
    fireEvent.keyDown(sub, { key: 'ArrowRight' });
    await flush();
    const groups = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    expect(groups).toEqual(expect.arrayContaining(['Top level', 'Insights']));
    expect(groups).not.toContain('Sales');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insights' }));
    await flush();
    expect(order()).toEqual(['home', ['sales', ['accounts']], ['insights', ['leads']]]);
  });

  it('「Add menu item」 holds a dashed row there, and the picker offers only what exists and is not in the menu', async () => {
    start();
    fireEvent.click(screen.getByTestId('design-menu-add-insights'));
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', ['…']]]);
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Objects' }));
    await flush();
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Cases']));
    expect(within(picker).queryByRole('button', { name: 'Leads' })).toBeNull();

    fireEvent.click(within(picker).getByRole('button', { name: 'Cases' }));
    await flush();
    expect(screen.queryByTestId('design-menu-picker')).toBeNull();
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', ['nav_item_1']]]);
    expect(screen.getByTestId('design-mode-menu')).toHaveTextContent('Cases');
  });

  it('the search runs over every kind; a record page is never offered', async () => {
    start();
    fireEvent.click(screen.getByTestId('design-menu-add-top'));
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.change(within(picker).getByTestId('design-menu-picker-search'), { target: { value: 'e' } });
    await flush();
    const rows = within(within(picker).getByTestId('design-menu-picker-rows')).getAllByRole('button').map((b) => b.textContent);
    expect(rows).toEqual(expect.arrayContaining(['CasesObjects', 'Hot leadsViews', 'WelcomePages']));
    expect(rows.join()).not.toContain('Lead record');
    // Pipeline is in the menu (Home opens it).
    expect(rows.join()).not.toContain('Pipeline');
  });

  it('「Remove from menu」 takes the entry off, and the picker offers it again', async () => {
    start();
    await act_on('leads', 'Remove from menu');
    expect(order()).toEqual(['home', ['sales', ['accounts']], ['insights', []]]);
    fireEvent.click(screen.getByTestId('design-menu-add-sales'));
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Objects' }));
    await flush();
    expect(within(picker).getByRole('button', { name: 'Leads' })).toBeInTheDocument();
  });

  it('「Rename and icon」 renames the entry in the menu', async () => {
    start();
    await act_on('leads', 'Rename and icon');
    const dialog = await screen.findByTestId('design-menu-rename');
    const name = within(dialog).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Prospects' } });
    fireEvent.change(within(dialog).getByLabelText('Icon'), { target: { value: 'user-plus' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await flush();
    expect(entry('leads')).toHaveTextContent('Prospects');
  });

  // Ruling (4) on review 7081226692: a name is changed in the app's source language only.
  it('under zh-CN, with English the default, the name is not changed: the field is closed and says why; the icon still is', async () => {
    session.language = 'zh-CN';
    start();
    await flush();
    await act_on('leads', 'Rename and icon');
    const dialog = await screen.findByTestId('design-menu-rename');
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    expect(within(dialog).getByTestId('design-menu-rename-source-only')).toHaveTextContent(
      "Menu names are changed in the app's source language",
    );
    fireEvent.change(within(dialog).getByLabelText('Icon'), { target: { value: 'user-plus' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await flush();
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const leads = (written[0][3] as { navigation: Array<{ children?: Array<Record<string, unknown>> }> }).navigation[1].children![0];
    expect(leads).toEqual({ id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Leads', icon: 'user-plus' });
  });

  it('in the default language, an entry shown under a label other than its stored one is not renamed here', async () => {
    storedNav.current = NAVIGATION.map((e) => (e.id === 'home' ? { ...e, label: 'apps.crm.home' } : e));
    start();
    await flush();
    await act_on('home', 'Rename and icon');
    expect(within(await screen.findByTestId('design-menu-rename')).getByLabelText('Name')).toBeDisabled();
  });

  it("another package's entry (served, not in the stored menu) says where it is changed, and is not moved or removed here", async () => {
    storedNav.current = NAVIGATION.map((e) =>
      e.id === 'sales' ? { ...e, children: (e.children ?? []).filter((c) => c.id !== 'accounts') } : e,
    );
    start();
    await flush();
    const trigger = within(entry('accounts')).getByTestId('design-menu-actions');
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await flush();
    expect(await screen.findByTestId('design-menu-contributed')).toHaveTextContent('Another package adds this item');
    for (const name of ['Move up', 'Rename and icon', 'Remove from menu']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByRole('menuitem', { name: 'Add an item after' })).not.toHaveAttribute('aria-disabled');
  });

  it("no entry is moved past another package's entry: 「Move down」 above it is off, and a drop on it does nothing", async () => {
    storedNav.current = NAVIGATION.map((e) =>
      e.id === 'sales' ? { ...e, children: (e.children ?? []).filter((c) => c.id !== 'accounts') } : e,
    );
    start();
    await flush();
    const trigger = within(entry('leads')).getByTestId('design-menu-actions');
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await flush();
    expect(await screen.findByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush();
    act(() => dragEnd.current!({ active: { id: 'home' }, over: { id: 'accounts' } }));
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
  });

  it("when the stored menu could not be read on entry, a move of another package's entry still writes none of it", async () => {
    storedNav.current = NAVIGATION.map((e) =>
      e.id === 'sales' ? { ...e, children: (e.children ?? []).filter((c) => c.id !== 'accounts') } : e,
    );
    storedNav.failReads = 1; // the editor's read on entry; the save's read answers
    start();
    await flush();
    await act_on('accounts', 'Move up');
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', []]]);
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const nav = (written[0][3] as { navigation: Array<{ id: string; children?: Array<{ id: string }> }> }).navigation;
    expect(nav[1].children!.map((c) => c.id)).toEqual(['leads']);
  });

  // L1-e review 7083961269 (1): contributions are appended when the app is
  // served, so an own entry put at or past them is drawn before them.
  const ACCOUNTS_CONTRIBUTED = () =>
    NAVIGATION.map((e) => (e.id === 'sales' ? { ...e, children: (e.children ?? []).filter((c) => c.id !== 'accounts') } : e));

  it("「Add menu item」 at the end of a group that ends with another package's entries holds the row, and puts the pick, before them", async () => {
    storedNav.current = ACCOUNTS_CONTRIBUTED();
    start();
    await flush();
    fireEvent.click(screen.getByTestId('design-menu-add-sales'));
    expect(order()).toEqual(['home', ['sales', ['leads', '…', 'accounts']], ['insights', []]]);
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Objects' }));
    await flush();
    fireEvent.click(within(picker).getByRole('button', { name: 'Cases' }));
    await flush();
    expect(order()).toEqual(['home', ['sales', ['leads', 'nav_item_1', 'accounts']], ['insights', []]]);
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const nav = (written[0][3] as { navigation: Array<{ id: string; children?: Array<{ id: string }> }> }).navigation;
    expect(nav[1].children!.map((c) => c.id)).toEqual(['leads', 'nav_item_1']);
  });

  it("「Add an item after」 on another package's entry, and 「Move to group」 into its group, land before it", async () => {
    storedNav.current = ACCOUNTS_CONTRIBUTED();
    start();
    await flush();
    await act_on('accounts', 'Add an item after');
    expect(order()).toEqual(['home', ['sales', ['leads', '…', 'accounts']], ['insights', []]]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush();
    const trigger = within(entry('home')).getByTestId('design-menu-actions');
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await flush();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to group' }));
    await flush();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sales' }));
    await flush();
    expect(order()).toEqual([['sales', ['leads', 'home', 'accounts']], ['insights', []]]);
  });

  it("dropped on the end of a group that ends with another package's entries, an entry lands before them", async () => {
    storedNav.current = ACCOUNTS_CONTRIBUTED();
    start();
    await flush();
    act(() => dragEnd.current!({ active: { id: 'home' }, over: { id: 'design-menu-end:sales' } }));
    expect(order()).toEqual([['sales', ['leads', 'home', 'accounts']], ['insights', []]]);
  });

  // L1-e review 7083961269 (2): the browser's own drag of an entry's link
  // would, dropped where the editor does not move it, open the link as a new
  // document; and the click a drag ends with is no click.
  it("an entry's link is not dragged by the browser, and the click a drag ends with opens nothing", async () => {
    storedNav.current = ACCOUNTS_CONTRIBUTED();
    render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <Harness />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('enter'));
    await flush();
    const leads = linkOf('leads');
    expect(leads).toHaveAttribute('draggable', 'false');
    expect(fireEvent.dragStart(leads)).toBe(false); // the native drag is refused
    expect(fireEvent.dragStart(linkOf('accounts'))).toBe(false);

    // Control: a plain click opens the entry's page, in the app.
    fireEvent.click(linkOf('home'));
    const opened = screen.getByTestId('where').textContent;
    expect(opened).not.toBe('/apps/crm');

    // A drag of leads refused on another package's entry, then the click it ends with.
    act(() => dragStart.current!({ active: { id: 'leads' } }));
    act(() => dragEnd.current!({ active: { id: 'leads' }, over: { id: 'accounts' } }));
    fireEvent.click(leads);
    expect(screen.getByTestId('where').textContent).toBe(opened);
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
  });

  // L1-e review 7084606001: on the real event order. dnd-kit's pointer sensor,
  // once a drag is active, stops the click that follows in the document's
  // capture phase without cancelling it, so a handler on React's root never
  // sees it and the link's default (a full navigation) would run.
  it('the click a real pointer drag ends with is cancelled before dnd-kit stops it', async () => {
    storedNav.current = ACCOUNTS_CONTRIBUTED();
    render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <Harness />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('enter'));
    await flush();
    const leads = linkOf('leads');
    const pointer = (type: string, target: EventTarget, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0, buttons: 1 });
      Object.defineProperty(event, 'isPrimary', { value: true });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      act(() => {
        target.dispatchEvent(event);
      });
    };
    let stoppedInDocument = false;
    const watch = () => {
      stoppedInDocument = true;
    };
    pointer('pointerdown', leads, 10);
    pointer('pointermove', document, 30); // past the 5 px activation distance
    pointer('pointermove', document, 40);
    pointer('pointerup', document, 40);
    const released = linkOf('leads'); // the link under the pointer when it is released
    document.addEventListener('click', watch); // bubble: reached only if dnd-kit did not stop it
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      released.dispatchEvent(click);
    });
    document.removeEventListener('click', watch);
    // dnd-kit takes its click listener off 50 ms after the drag; wait before
    // asserting, so a failure here leaves no listener to the next case.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(stoppedInDocument).toBe(false); // dnd-kit stopped it, as in the browser
    expect(click.defaultPrevented).toBe(true); // and its default is cancelled

    // A plain click afterwards is a click again: it opens the entry's page.
    const before = screen.getByTestId('where').textContent;
    fireEvent.click(linkOf('leads'));
    expect(screen.getByTestId('where').textContent).not.toBe(before);
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
  });

  // Review 7085270448 S3: dnd-kit reports a drag's start at 5 px but its end
  // only after the start has rendered, so a flick released first can end with
  // no end reported. The release itself ends it: links open again.
  it('a drag whose end dnd-kit never reports (a fast flick) does not leave the links shut', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <Harness />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('enter'));
    await flush();
    act(() => dragStart.current!({ active: { id: 'leads' } })); // started, and no end reported
    fireEvent.pointerUp(window);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    fireEvent.click(linkOf('home'));
    expect(screen.getByTestId('where').textContent).not.toBe('/apps/crm');
  });

  it('adding and moving stay open under zh-CN', async () => {
    session.language = 'zh-CN';
    start();
    await flush();
    await act_on('accounts', 'Move up');
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', []]]);
    fireEvent.click(screen.getByTestId('design-menu-add-insights'));
    expect(await screen.findByTestId('design-menu-picker')).toBeInTheDocument();
  });

  // N4 on review 7081253549: the drop's wiring, to another group.
  it('an entry dropped on another group\'s end moves there; dropped on an entry elsewhere, it takes that place', async () => {
    start();
    act(() => dragEnd.current!({ active: { id: 'leads' }, over: { id: 'design-menu-end:insights' } }));
    expect(order()).toEqual(['home', ['sales', ['accounts']], ['insights', ['leads']]]);
    act(() => dragEnd.current!({ active: { id: 'accounts' }, over: { id: 'home' } }));
    expect(order()).toEqual(['accounts', 'home', ['sales', []], ['insights', ['leads']]]);
    act(() => dragEnd.current!({ active: { id: 'home' }, over: { id: 'design-menu-end:' } }));
    expect(order()).toEqual(['accounts', ['sales', []], ['insights', ['leads']], 'home']);

    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const nav = (written[0][3] as { navigation: Array<{ id: string; children?: Array<{ id: string }> }> }).navigation;
    expect(nav.map((e) => [e.id, e.children?.map((c) => c.id)])).toEqual([
      ['accounts', undefined],
      ['sales', []],
      ['insights', ['leads']],
      ['home', undefined],
    ]);
  });

  it('「Cancel」 after three edits leaves the menu as it was, and writes nothing', async () => {
    start();
    await act_on('accounts', 'Move up');
    await act_on('home', 'Remove from menu');
    await act_on('leads', 'Move down');
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    fireEvent.click(screen.getByText('enter'));
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
    expect(written).toEqual([]);
  });

  // Card comment 7079728193: unsaved menu changes ask before the app is left,
  // in the shell's one unsaved-changes prompt (stay, or leave and drop them).
  it('a moved entry not yet saved: switching app asks first; staying keeps the change, leaving goes on', async () => {
    const confirmSpy = vi.fn((_message?: string): boolean => false);
    vi.stubGlobal('confirm', confirmSpy);
    start();
    await act_on('accounts', 'Move up');
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', []]]);

    fireEvent.click(screen.getByText('switch to hr'));
    expect(confirmSpy).toHaveBeenCalledWith('Leave Design layout? Your unsaved changes will be lost.');
    expect(switchedTo).toEqual([]);
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', []]]);
    expect(written).toEqual([]);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('switch to hr'));
    expect(switchedTo).toEqual(['hr']);
    expect(written).toEqual([]);
  });

  it('a reload or a tab close is held while a menu change is unsaved, and not once it is saved', async () => {
    const held = () => {
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      return unload.defaultPrevented;
    };
    start();
    expect(held()).toBe(false);
    await act_on('accounts', 'Move up');
    expect(held()).toBe(true);
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    expect(held()).toBe(false);
  });

  it('with nothing changed, switching app asks nothing', () => {
    const confirmSpy = vi.fn((_message?: string): boolean => false);
    vi.stubGlobal('confirm', confirmSpy);
    start();
    fireEvent.click(screen.getByText('switch to hr'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(switchedTo).toEqual(['hr']);
  });
});

/** objectstack#36364 — where the page went, and the navigation state it went with. */
function Landing() {
  const location = useLocation();
  return <span data-testid="landing">{`${location.pathname} ${JSON.stringify(location.state)}`}</span>;
}

function startWithLanding() {
  render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <Harness />
      <Landing />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('enter'));
}

/** 「Add menu item」 under Insights, then 「Dashboards」: the picker's dashboard list. */
async function openDashboards() {
  fireEvent.click(screen.getByTestId('design-menu-add-insights'));
  const picker = await screen.findByTestId('design-menu-picker');
  fireEvent.click(within(picker).getByRole('button', { name: 'Dashboards' }));
  await flush();
  return picker;
}

describe('a new dashboard from 「Add menu item」 (objectstack#36364)', () => {
  it('「Dashboards」 lists 「New dashboard…」 first, above the dashboards not in the menu yet', async () => {
    listed.dashboard = [{ name: 'revenue', label: 'Revenue' }];
    try {
      start();
      const picker = await openDashboards();
      const rows = within(within(picker).getByTestId('design-menu-picker-rows')).getAllByRole('button').map((b) => b.textContent);
      expect(rows).toEqual(['New dashboard…', 'Revenue']);
      // Another kind has no such row.
      fireEvent.click(within(picker).getByRole('button', { name: 'Dashboards' }));
      fireEvent.click(within(picker).getByRole('button', { name: 'Reports' }));
      await flush();
      expect(within(picker).queryByText('New dashboard…')).toBeNull();
    } finally {
      listed.dashboard = [];
    }
  });

  it('「Cancel」 at the name writes nothing and leaves nothing in the menu', async () => {
    start();
    const picker = await openDashboards();
    fireEvent.click(within(picker).getByTestId('design-menu-picker-new-dashboard'));
    const naming = await screen.findByTestId('design-menu-new-dashboard');
    fireEvent.change(within(naming).getByTestId('design-menu-new-name'), { target: { value: 'Payment analysis' } });
    fireEvent.click(within(naming).getByTestId('design-menu-new-cancel'));
    await flush();
    expect(screen.queryByTestId('design-menu-new-dashboard')).toBeNull();
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
    expect(written).toEqual([]);
    expect(screen.getByTestId('design-mode-save')).toBeDisabled();
  });

  it('「Create」: the dashboard, then the menu with its entry in the held place and every other staged edit; the mode is left and the dashboard opens for editing', async () => {
    server.held.add('dashboard/payment_analysis'); // a dashboard of another app holds the plain name
    startWithLanding();
    await act_on('accounts', 'Move up'); // another staged edit, saved with it
    const picker = await openDashboards();
    fireEvent.click(within(picker).getByTestId('design-menu-picker-new-dashboard'));
    const naming = await screen.findByTestId('design-menu-new-dashboard');
    fireEvent.change(within(naming).getByTestId('design-menu-new-name'), { target: { value: 'Payment analysis' } });
    expect(written).toEqual([]);
    fireEvent.click(within(naming).getByTestId('design-menu-new-create'));
    await flush();
    await flush();
    await flush();

    expect(written.map(([verb, type, name]) => `${verb} ${type} ${name}`)).toEqual([
      'save dashboard payment_analysis_2',
      'publish dashboard payment_analysis_2',
      'save app crm',
      'publish app crm',
    ]);
    expect(written[0][3]).toEqual({ name: 'payment_analysis_2', label: 'Payment analysis', widgets: [] });
    const navigation = (written[2][3] as { navigation: Array<{ id: string; children?: unknown[] }> }).navigation;
    expect(navigation[1].children!.map((c) => (c as { id: string }).id)).toEqual(['accounts', 'leads']);
    expect(navigation[2].children).toEqual([{ id: 'nav_item_1', type: 'dashboard', dashboardName: 'payment_analysis_2' }]);
    expect(screen.queryByTestId('design-mode-bar')).toBeNull();
    expect(screen.getByTestId('landing')).toHaveTextContent(
      '/apps/crm/dashboard/payment_analysis_2 {"designModeNewDashboard":"payment_analysis_2"}',
    );
  });

  it('a refused menu removes the new dashboard; the mode, the held place and the other staged edits stay', async () => {
    server.appSave = new Error('the app was refused');
    startWithLanding();
    await act_on('accounts', 'Move up');
    const picker = await openDashboards();
    fireEvent.click(within(picker).getByTestId('design-menu-picker-new-dashboard'));
    const naming = await screen.findByTestId('design-menu-new-dashboard');
    fireEvent.change(within(naming).getByTestId('design-menu-new-name'), { target: { value: 'Payment analysis' } });
    fireEvent.click(within(naming).getByTestId('design-menu-new-create'));
    await flush();
    await flush();
    await flush();

    expect(written.map(([verb, type, name, opt]) => `${verb} ${type} ${name} ${JSON.stringify(opt)}`)).toEqual([
      'save dashboard payment_analysis {"name":"payment_analysis","label":"Payment analysis","widgets":[]}',
      'publish dashboard payment_analysis {"packageId":"com.acme.crm"}',
      expect.stringMatching(/^save app crm /),
      'reset dashboard payment_analysis {"packageId":"com.acme.crm"}',
    ]);
    expect(toastError).toHaveBeenCalledWith('Some changes were not saved: the app was refused');
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
    expect(screen.getByTestId('design-menu-new-dashboard')).toBeInTheDocument();
    expect(order()).toEqual(['home', ['sales', ['accounts', 'leads']], ['insights', ['…']]]);
    expect(screen.getByTestId('landing')).toHaveTextContent('/apps/crm null');
  });
});

/** 「Add menu item」 under Insights, then 「Reports」. */
async function openReports() {
  fireEvent.click(screen.getByTestId('design-menu-add-insights'));
  const picker = await screen.findByTestId('design-menu-picker');
  fireEvent.click(within(picker).getByRole('button', { name: 'Reports' }));
  await flush();
  return picker;
}

/**
 * objectstack#36692 — the design mode stops hosting the report builder (the
 * maintainer's 「照 Twenty 分开」): 「Reports」 only links reports that exist;
 * a new report is made from the reports index, with its own Save.
 */
describe('「Reports」 links existing reports only (objectstack#36692)', () => {
  it('lists the reports not in the menu yet, and no 「New report…」 row', async () => {
    listed.report = [
      { name: 'pipeline', label: 'Pipeline' },
      { name: 'revenue_by_month', label: 'Revenue by month' },
    ];
    try {
      start();
      const picker = await openReports();
      const rows = within(within(picker).getByTestId('design-menu-picker-rows')).getAllByRole('button').map((b) => b.textContent);
      // The report the menu already opens (Home → pipeline) is not offered again.
      expect(rows).toEqual(['Revenue by month']);
      expect(within(picker).queryByTestId('design-menu-picker-new-report')).toBeNull();
      expect(within(picker).queryByText('New report…')).toBeNull();
    } finally {
      listed.report = [{ name: 'pipeline', label: 'Pipeline' }];
    }
  });

  it('picking one links it in the held place, staged with the mode; nothing is written, nothing navigates', async () => {
    listed.report = [{ name: 'revenue_by_month', label: 'Revenue by month' }];
    try {
      startWithLanding();
      const picker = await openReports();
      fireEvent.click(within(picker).getByRole('button', { name: 'Revenue by month' }));
      await flush();
      expect(screen.queryByTestId('design-menu-picker')).toBeNull();
      expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', ['nav_item_1']]]);
      expect(written).toEqual([]);
      expect(screen.getByTestId('landing')).toHaveTextContent('/apps/crm null');
      expect(screen.getByTestId('design-mode-save')).toBeEnabled();
    } finally {
      listed.report = [{ name: 'pipeline', label: 'Pipeline' }];
    }
  });
});

// ── objectstack#36591 ─────────────────────────────────────────────────────────

/**
 * objectstack#36591 — the design mode's menu reads, and saves, in the order
 * the sidebar draws it.
 *
 * The sidebar sorts each level by `order` (`byNavOrder`, internal to
 * `@object-ui/layout`); the editor read and saved array order, so a move in an
 * app whose entries carry `order` (an AI-built app's do) was saved and changed
 * nothing on screen. The sidebar here is the real one (`NavigationRenderer`),
 * drawn over what the save wrote, so these pins state no sort of their own.
 */
describe('the design-mode menu in the sidebar order (objectstack#36591)', () => {
  const object = (id: string, objectName: string, label: string, order?: number) => ({
    id,
    type: 'object',
    objectName,
    label,
    ...(order === undefined ? {} : { order }),
  });

  /** Authored out of `order`: the sidebar reads Customers, Contacts, Opportunities, Reports (Follow-ups, Pipeline). */
  const ORDERED = () => [
    object('opps', 'crm_opportunity', 'Opportunities', 2),
    object('customers', 'crm_customer', 'Customers', 0),
    {
      id: 'reports',
      type: 'group',
      label: 'Reports',
      order: 3,
      expanded: true,
      children: [
        { id: 'pipeline', type: 'report', reportName: 'pipeline', label: 'Pipeline', order: 1 },
        object('followups', 'crm_follow_up', 'Follow-ups', 0),
      ],
    },
    object('contacts', 'crm_contact', 'Contacts', 1),
  ];

  const LABELS = ['Customers', 'Contacts', 'Opportunities', 'Reports', 'Follow-ups', 'Pipeline', 'Cases', 'Leads', 'Accounts', 'Home', 'Sales', 'Insights'];

  /** The labels `el` shows, in the order it shows them; each must show once. */
  function labelsIn(el: Element): string[] {
    const text = el.textContent ?? '';
    const shown = LABELS.filter((l) => text.includes(l));
    for (const l of shown) expect(text.indexOf(l)).toBe(text.lastIndexOf(l));
    return shown.sort((a, b) => text.indexOf(a) - text.indexOf(b));
  }

  /** The running app's sidebar over `nav`. */
  function sidebarOrder(nav: unknown): string[] {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <SidebarProvider defaultOpen>
          <NavigationRenderer
            items={nav as NavigationItem[]}
            basePath="/apps/crm"
            resolveTargetLabel={(target) => (target.kind === 'object' ? OBJECT_LABELS[target.objectName] : undefined)}
          />
        </SidebarProvider>
      </MemoryRouter>,
    );
    const shown = labelsIn(container);
    unmount();
    return shown;
  }

  /** The design mode's menu, as it reads. */
  const editorOrder = () => labelsIn(screen.getByTestId('design-mode-menu'));

  async function save(): Promise<Array<Record<string, unknown>>> {
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    expect(written.map(([verb]) => verb)).toEqual(['save', 'publish']);
    return (written[0][3] as { navigation: Array<Record<string, unknown>> }).navigation;
  }

  /** Every `order` key of `nav`, at every depth. */
  const orderKeys = (nav: unknown): unknown[] =>
    (nav as Array<Record<string, unknown>>).flatMap((e) => [
      ...('order' in e ? [e.order] : []),
      ...(Array.isArray(e.children) ? orderKeys(e.children) : []),
    ]);

  it('an app whose entries carry `order` reads in the design mode as in the sidebar', () => {
    servedNav.current = ORDERED();
    start();
    expect(editorOrder()).toEqual(['Customers', 'Contacts', 'Opportunities', 'Reports', 'Follow-ups', 'Pipeline']);
    cleanup();
    expect(sidebarOrder(ORDERED())).toEqual(['Customers', 'Contacts', 'Opportunities', 'Reports', 'Follow-ups', 'Pipeline']);
  });

  it('「Move up」 on Contacts, saved: the sidebar reads Contacts, Customers, …, and the design mode reads the same again', async () => {
    servedNav.current = ORDERED();
    start();
    await act_on('contacts', 'Move up');
    const shown = editorOrder();
    expect(shown).toEqual(['Contacts', 'Customers', 'Opportunities', 'Reports', 'Follow-ups', 'Pipeline']);
    const saved = await save();
    cleanup();
    expect(sidebarOrder(saved)).toEqual(shown);
    // The saved app, served again, opens the design mode in that order.
    servedNav.current = saved;
    storedNav.current = saved;
    start();
    expect(editorOrder()).toEqual(shown);
  });

  it('「Add an item after」 and 「Move to group」, saved: the sidebar puts both where the design mode showed them', async () => {
    servedNav.current = ORDERED();
    start();
    await flush();
    await act_on('contacts', 'Add an item after');
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Objects' }));
    await flush();
    fireEvent.click(within(picker).getByRole('button', { name: 'Cases' }));
    await flush();
    const trigger = within(entry('customers')).getByTestId('design-menu-actions');
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await flush();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to group' }));
    await flush();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reports' }));
    await flush();
    const shown = editorOrder();
    expect(shown).toEqual(['Contacts', 'Cases', 'Opportunities', 'Reports', 'Follow-ups', 'Pipeline', 'Customers']);
    const saved = await save();
    cleanup();
    expect(sidebarOrder(saved)).toEqual(shown);
  });

  it('CONTROL: an app whose entries carry no `order` saves a move by array order, and gains no `order` key', async () => {
    start();
    await act_on('accounts', 'Move up');
    const shown = editorOrder();
    expect(shown).toEqual(['Home', 'Sales', 'Accounts', 'Leads', 'Insights']);
    const saved = await save();
    expect(orderKeys(saved)).toEqual([]);
    cleanup();
    // The sidebar draws no empty group: Insights is the editor's alone.
    expect(sidebarOrder(saved)).toEqual(shown.filter((label) => label !== 'Insights'));
  });

  it('a level where some entries carry `order` and some do not: one save, and the sidebar reads as the design mode', async () => {
    // The sidebar reads an absent `order` as 0: Customers, Contacts, Opportunities.
    const MIXED = () => [object('opps', 'crm_opportunity', 'Opportunities', 1), object('customers', 'crm_customer', 'Customers'), object('contacts', 'crm_contact', 'Contacts')];
    servedNav.current = MIXED();
    start();
    expect(editorOrder()).toEqual(['Customers', 'Contacts', 'Opportunities']);
    await act_on('opps', 'Move up');
    const shown = editorOrder();
    expect(shown).toEqual(['Customers', 'Opportunities', 'Contacts']);
    const saved = await save();
    expect(orderKeys(saved)).toEqual([0, 1, 2]);
    cleanup();
    expect(sidebarOrder(saved)).toEqual(shown);
  });
});

describe('the design-mode menu save and drag, hardened (objectstack#36538)', () => {
  /** Accounts is another package's entry, appended to Sales when the app is served. */
  const ACCOUNTS_FOREIGN = () =>
    NAVIGATION.map((e) => (e.id === 'sales' ? { ...e, children: (e.children ?? []).filter((c) => c.id !== 'accounts') } : e));
  /** A group another package puts into the menu, with its own entry. */
  const PARTNER = { id: 'partner', type: 'group', label: 'Partner', children: [{ id: 'partner_cases', type: 'object', objectName: 'crm_case', label: 'Cases' }] };

  function startWhere() {
    render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <Harness />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('enter'));
  }
  const where = () => screen.getByTestId('where').textContent;
  /** A press on `el`, released, then the click it ends with. */
  const press = (el: Element) => {
    fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse' });
    fireEvent.click(el);
  };
  /** Opens 「⋮ → Move to group」 of the entry `id` and answers the groups it offers. */
  async function groupsOffered(id: string): Promise<string[]> {
    fireEvent.pointerDown(within(entry(id)).getByTestId('design-menu-actions'), { button: 0, pointerType: 'mouse' });
    await flush();
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Move to group' }), { key: 'ArrowRight' });
    await flush();
    return (await screen.findAllByRole('menuitem')).map((m) => m.textContent ?? '');
  }
  /** A clock the editor's click window reads, moved by hand. */
  function clock() {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    return { pass: (ms: number) => (now += ms), restore: () => spy.mockRestore() };
  }

  // Item 2 (review N8): the layered read answers a 404 as an empty view.
  it('a stored read answering 404: 「Save」 writes nothing and the bar says so; on entry no entry reads as another package\'s', async () => {
    storedNav.missing = true;
    start();
    await flush();
    // CONTROL of the entry read: an empty stored menu would mark every entry another package's and shut 「Move up」.
    fireEvent.pointerDown(within(entry('accounts')).getByTestId('design-menu-actions'), { button: 0, pointerType: 'mouse' });
    await flush();
    expect(screen.queryByTestId('design-menu-contributed')).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    await flush();
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    expect(written).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain("This app's saved menu could not be read");
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
  });

  // Item 4 (review N6): the publish is pinned, and a publish landed in between is said.
  it("「Save」 pins the publish to the read's published row; a publish landed in between is refused, discarded and said", async () => {
    storedNav.overlayVersion = 'v7';
    server.appPublish = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    start();
    await flush();
    await act_on('accounts', 'Move up');
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    expect(written.map(([verb]) => verb)).toEqual(['save', 'publish', 'reset']);
    expect(written[1]).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm', ifMatch: 'v7' }]);
    expect(String(toastError.mock.calls[0][0])).toContain("Someone published this app's menu while you were saving");
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
  });

  // Item 3 (review N9): another package's group takes no own entry.
  it("another package's group is not offered by 「Move to group」, has no 「Add menu item」, and takes no drop", async () => {
    servedNav.current = [...NAVIGATION, PARTNER];
    storedNav.current = NAVIGATION;
    start();
    await flush();
    const offered = await groupsOffered('leads');
    expect(offered).toContain('Insights'); // CONTROL: an own group is offered
    expect(offered).not.toContain('Partner');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush();
    expect(screen.getByTestId('design-menu-add-insights')).toBeInTheDocument(); // CONTROL
    expect(screen.queryByTestId('design-menu-add-partner')).toBeNull();

    act(() => dragEnd.current!({ active: { id: 'home' }, over: { id: 'design-menu-end:partner' } }));
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []], ['partner', ['partner_cases']]]);
    act(() => dragEnd.current!({ active: { id: 'home' }, over: { id: 'design-menu-end:insights' } })); // CONTROL
    expect(order()).toEqual([['sales', ['leads', 'accounts']], ['insights', ['home']], ['partner', ['partner_cases']]]);
  });

  it("「Add an item before / after」 is off on an entry of another package's group, and open on one of an own group", async () => {
    servedNav.current = [...NAVIGATION, PARTNER];
    storedNav.current = NAVIGATION;
    start();
    await flush();
    fireEvent.pointerDown(within(entry('partner_cases')).getByTestId('design-menu-actions'), { button: 0, pointerType: 'mouse' });
    await flush();
    for (const name of ['Add an item before', 'Add an item after']) {
      expect(await screen.findByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush();
    fireEvent.pointerDown(within(entry('accounts')).getByTestId('design-menu-actions'), { button: 0, pointerType: 'mouse' });
    await flush();
    expect(await screen.findByRole('menuitem', { name: 'Add an item after' })).not.toHaveAttribute('aria-disabled');
  });

  // N10: an add made while the stored read is pending is drawn where it is saved, once the read lands.
  it("an entry added at a group's end while the stored read is pending is drawn before another package's entries once it lands", async () => {
    storedNav.current = ACCOUNTS_FOREIGN();
    let land!: () => void;
    storedNav.gate = new Promise<void>((resolve) => (land = resolve));
    start();
    await flush();
    fireEvent.click(screen.getByTestId('design-menu-add-sales'));
    const picker = await screen.findByTestId('design-menu-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Objects' }));
    await flush();
    fireEvent.click(within(picker).getByRole('button', { name: 'Cases' }));
    await flush();
    // CONTROL: still pending, nothing tells Accounts apart, the entry is drawn last.
    expect(order()).toEqual(['home', ['sales', ['leads', 'accounts', 'nav_item_1']], ['insights', []]]);
    await act(async () => land());
    await flush();
    expect(order()).toEqual(['home', ['sales', ['leads', 'nav_item_1', 'accounts']], ['insights', []]]);
    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const nav = (written[0][3] as { navigation: Array<{ id: string; children?: Array<{ id: string }> }> }).navigation;
    expect(nav[1].children!.map((c) => c.id)).toEqual(['leads', 'nav_item_1']);
  });

  // N12: the window starts at the release of the press that dragged.
  it('a pointer drag cancelled by Escape with the button held: the late release opens nothing; a plain click then opens', async () => {
    const time = clock();
    try {
      startWhere();
      await flush();
      const leads = linkOf('leads');
      fireEvent.pointerDown(leads, { button: 0, pointerType: 'mouse' });
      act(() => dragStart.current!({ active: { id: 'leads' }, activatorEvent: new MouseEvent('pointerdown') }));
      act(() => dragCancel.current!({ active: { id: 'leads' } }));
      time.pass(2_000); // the button held long past the old window
      fireEvent.pointerUp(leads, { button: 0, pointerType: 'mouse' });
      fireEvent.click(leads);
      expect(where()).toBe('/apps/crm');
      time.pass(1_000);
      press(linkOf('home')); // CONTROL
      expect(where()).not.toBe('/apps/crm');
    } finally {
      time.restore();
    }
  });

  // N15: each clear of the drag flag has its own case.
  it('a new press clears a drag whose end was never reported: its click opens the page', async () => {
    startWhere();
    await flush();
    act(() => dragStart.current!({ active: { id: 'leads' } })); // started, no end, no pointer held
    press(linkOf('home'));
    expect(where()).not.toBe('/apps/crm');
  });

  it('a window pointercancel clears a drag whose end was never reported: a later click opens the page', async () => {
    const time = clock();
    try {
      startWhere();
      await flush();
      act(() => dragStart.current!({ active: { id: 'leads' } }));
      fireEvent.pointerCancel(window);
      time.pass(1_000);
      fireEvent.click(linkOf('home'));
      expect(where()).not.toBe('/apps/crm');
    } finally {
      time.restore();
    }
  });

  // N16: a keyboard move keeps the links shut whatever the pointer does.
  it('a click during a held keyboard move opens nothing; once the move ends, a click opens', async () => {
    const time = clock();
    try {
      startWhere();
      await flush();
      act(() => dragStart.current!({ active: { id: 'leads' }, activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }) }));
      press(linkOf('home'));
      expect(where()).toBe('/apps/crm');
      act(() => dragEnd.current!({ active: { id: 'leads' }, over: null }));
      time.pass(1_000);
      press(linkOf('home')); // CONTROL
      expect(where()).not.toBe('/apps/crm');
    } finally {
      time.restore();
    }
  });

  // N13: Space moves, Enter opens; the editor says so.
  it('Space on an entry starts a keyboard move; Enter does not, and is left to open the link; the editor says which', async () => {
    start();
    await flush();
    const leads = linkOf('leads');
    leads.focus();
    expect(fireEvent.keyDown(leads, { code: 'Enter', key: 'Enter' })).toBe(true); // not taken: the link opens
    await flush();
    expect(dragStarts).toHaveLength(0);
    expect(fireEvent.keyDown(leads, { code: 'Space', key: ' ' })).toBe(false); // taken by the move
    await flush();
    expect(dragStarts).toHaveLength(1);
    fireEvent.keyDown(leads, { code: 'Escape', key: 'Escape' });
    await flush();
    // The help the editor shows is the one a screen reader is given for an entry.
    const hint = screen.getByTestId('design-menu-keyboard-hint').textContent;
    expect(hint).toBeTruthy();
    expect(document.getElementById(linkOf('leads').getAttribute('aria-describedby') ?? '')?.textContent).toBe(hint);
  });

  // N14: a drop outside the menu moves nothing.
  describe('the collision rule', () => {
    const rect = { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 };
    const args = (pointer: { x: number; y: number } | null) =>
      ({
        active: { id: 'leads', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
        collisionRect: rect,
        droppableRects: new Map([['home', rect]]),
        droppableContainers: [{ id: 'home', key: 'home', data: { current: {} }, disabled: false, node: { current: null }, rect: { current: rect } }],
        pointerCoordinates: pointer,
      }) as unknown as Parameters<CollisionDetection>[0];

    it("the editor's rule: a pointer outside the menu is over nothing; inside it, and from the keyboard, the nearest entry", async () => {
      start();
      await flush();
      vi.spyOn(screen.getByTestId('design-menu-area'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 400));
      const rule = collisionRule.current!;
      expect(rule(args({ x: 900, y: 900 }))).toEqual([]);
      expect((rule(args({ x: 50, y: 10 })) as Array<{ id: string }>).map((c) => c.id)).toEqual(['home']);
      expect((rule(args(null)) as Array<{ id: string }>).map((c) => c.id)).toEqual(['home']);
      expect(closestCenter(args({ x: 900, y: 900 })).map((c) => c.id)).toEqual(['home']); // CONTROL: the old rule moved it
    });

    it('a drop the rule answers nothing for moves nothing', async () => {
      start();
      await flush();
      act(() => dragEnd.current!({ active: { id: 'home' }, over: null }));
      expect(order()).toEqual(['home', ['sales', ['leads', 'accounts']], ['insights', []]]);
    });
  });
});

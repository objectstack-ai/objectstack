// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's menu under the design mode (objectstack#36363), drawn by its
 * editor under the shell's mode and saved through the mode's 「Save」.
 *
 * Real subjects: `DesignModeMenu`, `useDesignModeController`,
 * `DesignModeProvider`, `DesignModeBar`, `saveAppMenu`. The metadata client
 * and the package doors are fakes that record what is written.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@object-ui/components';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

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
const client = vi.hoisted(() => ({
  list: async (type: string) => listed[type] ?? [],
  get: async () => ({ name: 'crm', label: 'CRM', navigation: [] }),
  save: async (...args: unknown[]) => {
    written.push(['save', ...args]);
    return {};
  },
  publish: async (...args: unknown[]) => {
    written.push(['publish', ...args]);
    return {};
  },
  reset: async () => ({}),
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
      <SidebarProvider>
        {mode.active && (
          <DesignModeMenu
            app={{ name: 'crm', navigation: NAVIGATION, _packageId: 'com.acme.crm' }}
            basePath="/apps/crm"
            resolveTargetLabel={(target) => (target.kind === 'object' ? OBJECT_LABELS[target.objectName] : undefined)}
          />
        )}
      </SidebarProvider>
    </DesignModeProvider>
  );
}

function Enter() {
  const mode = useDesignMode();
  return (
    <button type="button" onClick={mode?.enter}>
      enter
    </button>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const entry = (id: string) => screen.getByTestId(`design-menu-entry-${id}`);
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
  toastError.mockReset();
});
afterEach(cleanup);

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
});

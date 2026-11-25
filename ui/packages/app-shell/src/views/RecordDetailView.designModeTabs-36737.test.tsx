// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36737 — the record page's tabs are part of the design mode. On
 * the desktop full page of an object whose package the administrator may
 * design, the design mode turns the tab row into the tabs editor in place,
 * under the mode's one bar: the page draws no bar of its own for it, and the
 * record's ⋯ offers no 「Configure tabs」 entry, in the mode or out of it.
 * Out of the mode the tab row is the page's own (the control). While the
 * record's own edit state is open, the tab row is not the editor (the gate
 * the old ⋯ entry kept), and it is again once the edit state is left.
 *
 * Read through the real `RecordDetailView` (synthesized default page, full
 * page) under the real `useDesignModeController` and `DesignModeBar`. Fakes:
 * Studio's design gate (it opens the object's package), the metadata client
 * and the package list the editor loads.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
// Studio's design gate opens the object's package: a workspace administrator
// on a self-built app.
vi.mock('../hooks/useStudioDesignGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useStudioDesignGate: (path: string | null) => path,
}));
const client = vi.hoisted(() => ({
  layered: async () => ({ code: { name: 'crm_account' }, effective: { name: 'crm_account' } }),
  get: async () => null,
  save: async () => ({}),
  publish: async () => ({}),
  reset: async () => ({}),
}));
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () => new Map([['app.crm', { id: 'app.crm', name: 'CRM', writable: true, manifest: {} }]]),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { FavoritesProvider } from '../context/FavoritesProvider';
import { DesignModeProvider, useDesignModeController } from '../layout/designMode';
import { DesignModeBar } from '../layout/DesignModeBar';

const RECORD_ID = 'rec-1';
const SHARE = { name: 'share', label: 'Share', type: 'url', target: 'https://example.com/s', locations: ['record_more'], order: 3 };

const OBJECTS = [
  {
    name: 'crm_account',
    label: 'Account',
    _packageId: 'app.crm',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    actions: [SHARE],
  },
  {
    name: 'crm_contact',
    label: 'Contact',
    _packageId: 'app.crm',
    fields: { name: { type: 'text', label: 'Name' }, account: { type: 'lookup', label: 'Account', reference: 'crm_account' } },
  },
];

/** The shell's design mode, its bar while it is on, and an enter button while it is off. */
function Shell({ children }: { children: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active ? <DesignModeBar mode={mode} /> : <button type="button" onClick={mode.enter}>design</button>}
      {children}
    </DesignModeProvider>
  );
}

/** A page that draws a master-detail body table (so Edit opens the record's edit state) and one related tab. */
const QUOTE_OBJECTS = [
  {
    name: 'crm_quote',
    label: 'Quote',
    _packageId: 'app.crm',
    fields: { id: { type: 'text', label: 'Id', group: 'basic' }, name: { type: 'text', label: 'Name', group: 'basic' } },
    fieldGroups: [
      { key: 'basic', label: 'Basic' },
      { key: 'lines', label: 'Lines', relatedList: 'crm_line' },
    ],
  },
  {
    name: 'crm_line',
    label: 'Line',
    pluralLabel: 'Lines',
    _packageId: 'app.crm',
    fields: { id: { type: 'text', label: 'Id' }, product: { type: 'text', label: 'Product' }, quote: { type: 'master_detail', reference: 'crm_quote', label: 'Quote' } },
  },
  {
    name: 'crm_note',
    label: 'Note',
    pluralLabel: 'Notes',
    _packageId: 'app.crm',
    fields: { id: { type: 'text', label: 'Id' }, body: { type: 'text', label: 'Body' }, quote: { type: 'lookup', reference: 'crm_quote', label: 'Quote' } },
  },
];

function mount({ objects = OBJECTS as any[], objectName = 'crm_account' }: { objects?: any[]; objectName?: string } = {}) {
  const metadata = {
    objects,
    pages: [],
    apps: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async (type: string, name: string) => (type === 'object' ? objects.find((o) => o.name === name) ?? null : null),
    getItemsByType: () => [],
  } as any;
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Acme' })),
    getObjectSchema: vi.fn(async (o: string) => objects.find((d) => d.name === o) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[`/apps/crm/${objectName}/record/${RECORD_ID}`]}>
            <Shell>
              <RecordDetailView
                dataSource={dataSource}
                objects={objects}
                onEdit={vi.fn()}
                objectNameOverride={objectName}
                recordIdOverride={RECORD_ID}
              />
            </Shell>
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

/** The record's ⋯ menu items, opened. */
async function moreMenuItems(): Promise<string[]> {
  const trigger = await screen.findByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  const items = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]')).map((e) => (e.textContent ?? '').trim());
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  return items;
}

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('objectstack#36737 — the record tabs in the design mode', () => {
  it('CONTROL — out of the mode: the tab row is the page\'s own, and the ⋯ offers no 「Configure tabs」', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
    const items = await moreMenuItems();
    expect(items).toContain('Share');
    expect(items).not.toContain('Configure tabs');
  });

  it('in the mode: the tab row is the editor under the one bar, and the ⋯ offers no 「Configure tabs」', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
    fireEvent.click(screen.getByText('design'));
    const editor = await screen.findByTestId('record-tabs-editor');
    expect(editor.querySelector('[data-record-tabs-tab="crm_contact.account"]')).not.toBeNull();
    // What a save writes through has loaded: the tab's controls are on.
    await waitFor(() =>
      expect(editor.querySelector('[data-record-tabs-tab="crm_contact.account"] [data-record-tabs-hide]')).toBeEnabled(),
    );
    expect(screen.getAllByTestId('design-mode-bar')).toHaveLength(1);
    expect(screen.queryByTestId('record-tabs-config-bar')).toBeNull();
    const items = await moreMenuItems();
    expect(items).toContain('Share');
    expect(items).not.toContain('Configure tabs');
  });
});

describe('objectstack#36737 — the record tabs and the record\'s own edit state', () => {
  beforeEach(() => {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 1440, bottom: 800, width: 1440, height: 800, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A button of the record page by its text, never one of the mode's bar (whose 「Cancel」 would leave the mode). */
  const button = (label: string) =>
    (Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label && !b.closest('[data-testid="design-mode-bar"]'),
    ) as HTMLButtonElement | undefined) ?? null;

  it('while the edit state is open the tab row is not the editor; leaving it brings the editor back', async () => {
    mount({ objects: QUOTE_OBJECTS, objectName: 'crm_quote' });
    await waitFor(() => expect(button('Edit')).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(screen.getByText('design'));
    await screen.findByTestId('record-tabs-editor');
    // CONTROL: the editor is on; the record's Edit opens its edit state.
    fireEvent.click(button('Edit')!);
    await waitFor(() => expect(document.querySelector('[data-body-table-editor]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
    expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
    fireEvent.click(button('Cancel')!);
    await waitFor(() => expect(document.querySelector('[data-body-table-editor]')).toBeNull(), { timeout: 5000 });
    expect(await screen.findByTestId('record-tabs-editor')).toBeInTheDocument();
  });
});

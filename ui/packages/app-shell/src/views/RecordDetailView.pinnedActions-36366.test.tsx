// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — the object's record-page pins (`pinnedActions.record`)
 * choose the record header's buttons, in order; every other placed action is
 * in the header's ⋯. Both record headers read them: the synthesized default
 * page's (`RecordDetailView`'s header list) and an authored `page:header` with
 * `placedActions: true` (`PageHeaderActions`). No pins: each header draws as
 * before (the control).
 *
 * Read through the real `RecordDetailView` → `page:header` renderer →
 * `PageHeaderActions`, embedded as `ObjectView`'s drawer mounts it (the drawer
 * keeps three inline buttons, so inline and ⋯ are told apart).
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

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { FavoritesProvider } from '../context/FavoritesProvider';

const RECORD_ID = 'rec-1';

const CONVERT = { name: 'convert', label: 'Convert', type: 'url', target: 'https://example.com/c', locations: ['record_header'], order: 1 };
const MARK_WON = { name: 'mark_won', label: 'Mark Won', type: 'url', target: 'https://example.com/w', locations: ['record_header'], order: 2 };
const SHARE = { name: 'share', label: 'Share', type: 'url', target: 'https://example.com/s', locations: ['record_header'], order: 3 };
const LOG_CALL = { name: 'log_call', label: 'Log Call', type: 'url', target: 'https://example.com/l', locations: ['record_more'], order: 4 };
const ACTIONS = [CONVERT, MARK_WON, SHARE, LOG_CALL];
const LABELS = ACTIONS.map((a) => a.label);

const PLACED_HEADER = { type: 'page:header', properties: { placedActions: true } };

function mount(pinnedActions: unknown, authoredHeader: boolean) {
  const objects = [
    {
      name: 'crm_deal',
      label: 'Deal',
      fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
      actions: ACTIONS,
      ...(pinnedActions ? { pinnedActions } : {}),
    },
  ];
  const pages = authoredHeader
    ? [
        {
          name: 'crm_deal_detail',
          label: 'Detail',
          type: 'record',
          object: 'crm_deal',
          kind: 'full',
          isDefault: true,
          regions: [{ name: 'main', width: 'full', components: [PLACED_HEADER, { type: 'record:details', properties: {} }] }],
        },
      ]
    : [];
  const metadata = {
    objects,
    pages,
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
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Big deal' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[`/apps/a/crm_deal?recordId=${RECORD_ID}`]}>
            <RecordDetailView
              dataSource={dataSource}
              objects={objects}
              onEdit={vi.fn()}
              objectNameOverride="crm_deal"
              recordIdOverride={RECORD_ID}
              embedded
            />
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

/** The object's actions among the header's inline buttons, then those only in its ⋯ menu. */
async function headerFaces(): Promise<{ inline: string[]; menu: string[] }> {
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
  await waitFor(() =>
    expect(
      Array.from(document.querySelector('[role="toolbar"]')!.querySelectorAll('button')).some((b) =>
        LABELS.includes((b.textContent ?? '').trim()),
      ),
    ).toBe(true),
  );
  const bar = document.querySelector('[role="toolbar"]') as HTMLElement;
  const inline = Array.from(bar.querySelectorAll('button'))
    .map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim())
    .filter((l) => LABELS.includes(l));
  const trigger = screen.queryByRole('button', { name: 'More actions' });
  if (!trigger) return { inline, menu: [] };
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  const menu = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]'))
    .map((e) => (e.textContent ?? '').trim())
    // The ⋯ also lists, for a narrow row, the buttons that may fold into it:
    // the menu's own actions are the ones drawn nowhere inline.
    .filter((l) => LABELS.includes(l) && !inline.includes(l));
  return { inline, menu };
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

describe.each([
  ['the synthesized default page', false],
  ['an authored page:header with placedActions: true', true],
] as const)('#36366 record header pins: %s', (_face, authored) => {
  it('CONTROL — no pins: the header draws as before (record_header inline by order, record_more in ⋯)', async () => {
    mount(undefined, authored);
    const { inline, menu } = await headerFaces();
    expect(inline).toEqual(['Convert', 'Mark Won', 'Share']);
    expect(menu).toEqual(['Log Call']);
  });

  it('the pinned actions are the buttons, in pin order (a record_more one too); the rest are in ⋯', async () => {
    mount({ record: ['log_call', 'share'] }, authored);
    const { inline, menu } = await headerFaces();
    expect(inline).toEqual(['Log Call', 'Share']);
    expect(menu).toEqual(expect.arrayContaining(['Convert', 'Mark Won']));
    expect(menu).toHaveLength(2);
  });

  it('a list-page arm alone leaves the record header as it was', async () => {
    mount({ list: ['$export'] }, authored);
    const { inline, menu } = await headerFaces();
    expect(inline).toEqual(['Convert', 'Mark Won', 'Share']);
    expect(menu).toEqual(['Log Call']);
  });
});

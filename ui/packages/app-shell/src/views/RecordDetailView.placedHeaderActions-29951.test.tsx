// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29951 — a header action another package places on `sys_user`
 * is drawn again on the user's record page, in the drawer and on the full page.
 *
 * #27219 rebuilt the platform record pages as `kind: 'full'` pages whose
 * `page:header` named the platform's own action ids, and an authored id list
 * is the whole set (#11592), so a `type: 'url'` action an installed package
 * places on `sys_user` at `record_header` stopped drawing in the 18.3 Console.
 * Ruling A (record 6624172200) gave the header an opt-in instead,
 * `placedActions: true` (objectstack#30018): every action of the page's object
 * placed at `record_header` / `record_more`, read live. The three platform
 * pages now ship exactly `{ type: 'page:header', properties: { placedActions:
 * true } }` (pinned in platform-objects' `record-page-header-actions.test.ts`
 * and plugin-approvals' `sys-approval-request-page.test.ts`; that package is
 * not a dependency of this tree, so the node is mirrored here, never imported).
 *
 * Read through the real `RecordDetailView` → `page:header` renderer →
 * `PageHeaderActions`, as the Console mounts it: the full page by its route,
 * and the drawer as `ObjectView`'s drawer mounts it (`embedded`, with the
 * object and record handed in).
 *
 *   - The card's pin: on the shipped header node, the packaged url action
 *     draws inline and the packaged `record_more` one in the ⋯ menu, beside
 *     the platform's own; actions placed elsewhere do not draw. On the frozen
 *     #27219 header (an id list, no opt-in) the same object draws neither
 *     packaged action, which is the regression this pin is red on.
 *   - CONTROL (#11592 unchanged): on a non-platform object `placedActions:
 *     true` draws its placed actions, and an authored list without the key
 *     draws exactly that list.
 *   - The refused pair (`true` beside a list) draws none of the object's
 *     actions and says so once.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

// The platform's own header actions, as `sys_user` places them.
const BAN_USER = { name: 'ban_user', label: 'Ban User', type: 'api', target: '/api/v1/x', locations: ['list_item', 'record_header'] };
const IMPERSONATE = { name: 'impersonate_user', label: 'Impersonate User', type: 'api', target: '/api/v1/y', locations: ['record_more'] };
// Placed elsewhere: never a header action.
const LIST_ONLY = { name: 'export_users', label: 'Export Users', type: 'api', target: '/api/v1/z', locations: ['list_toolbar'] };
const SECTION_ONLY = { name: 'reset_mfa', label: 'Reset MFA', type: 'api', target: '/api/v1/w', locations: ['record_section'] };
// What another package adds to `sys_user` (the folded registry appends it).
const PACKAGED_URL = { name: 'qa_open_profile', label: 'Open Profile', type: 'url', target: 'https://example.com/u', locations: ['record_header'], _packageId: 'com.qa.hdr' };
const PACKAGED_MORE = { name: 'qa_profile_link', label: 'Copy Profile Link', type: 'url', target: 'https://example.com/l', locations: ['record_more'], _packageId: 'com.qa.hdr' };

const ACTIONS = [BAN_USER, IMPERSONATE, LIST_ONLY, SECTION_ONLY, PACKAGED_URL, PACKAGED_MORE];

/** `sys_user_detail`'s shipped header node (#29951). */
const SHIPPED_HEADER = { type: 'page:header', properties: { placedActions: true } };
/** The frozen #27219 shape: the platform's own ids, no opt-in. */
const FROZEN_HEADER = { type: 'page:header', properties: { actions: ['ban_user', 'impersonate_user'] } };

function objectDef(name: string) {
  return {
    name,
    label: name,
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    actions: ACTIONS,
  };
}

function fullPage(object: string, header: Record<string, unknown>) {
  return {
    name: `${object}_detail`,
    label: 'Detail',
    type: 'record',
    object,
    kind: 'full',
    isDefault: true,
    regions: [{ name: 'main', width: 'full', components: [header, { type: 'record:details', properties: {} }] }],
  };
}

type Face = 'page' | 'drawer';

function mount(objectName: string, header: Record<string, unknown>, face: Face) {
  const objects = [objectDef(objectName)];
  const pages = [fullPage(objectName, header)];
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
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Ada' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  const view =
    face === 'page' ? (
      <MemoryRouter initialEntries={[`/apps/a/${objectName}/record/${RECORD_ID}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={dataSource} objects={objects} onEdit={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>
    ) : (
      // The drawer: `ObjectView` mounts the detail embedded over its list route.
      <MemoryRouter initialEntries={[`/apps/a/${objectName}?recordId=${RECORD_ID}`]}>
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={vi.fn()}
          objectNameOverride={objectName}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MemoryRouter>
    );
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>{view}</FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

/** The header's inline buttons, then its ⋯ menu rows. */
async function headerFaces(): Promise<{ inline: string[]; menu: string[] }> {
  const bar = document.querySelector('[role="toolbar"]') as HTMLElement;
  const inline = Array.from(bar.querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(),
  );
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  const menu = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]')).map((e) =>
    (e.textContent ?? '').trim(),
  );
  return { inline, menu };
}

/** Mount and wait until the object's actions have resolved into the header. */
async function mountResolved(objectName: string, header: Record<string, unknown>, face: Face) {
  mount(objectName, header, face);
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ban User' })).toBeInTheDocument());
  return headerFaces();
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

describe.each<Face>(['page', 'drawer'])('#29951 sys_user record header (%s)', (face) => {
  it('draws the action another package places on sys_user, on the shipped placedActions header', async () => {
    const { inline, menu } = await mountResolved('sys_user', SHIPPED_HEADER, face);
    expect(inline).toContain('Open Profile');
    expect(menu).toContain('Copy Profile Link');
    // The platform's own placed actions stay, and nothing placed elsewhere draws.
    expect(inline).toContain('Ban User');
    expect(menu).toContain('Impersonate User');
    for (const label of ['Export Users', 'Reset MFA']) {
      expect(inline).not.toContain(label);
      expect(menu).not.toContain(label);
    }
  });

  it('drew neither packaged action on the frozen #27219 header (the regression)', async () => {
    const { inline, menu } = await mountResolved('sys_user', FROZEN_HEADER, face);
    expect(inline).toContain('Ban User');
    expect(menu).toContain('Impersonate User');
    expect([...inline, ...menu]).not.toContain('Open Profile');
    expect([...inline, ...menu]).not.toContain('Copy Profile Link');
  });
});

describe('#29951 CONTROL — a non-platform page', () => {
  it('placedActions: true draws the object\'s placed actions, in declaration order', async () => {
    const { inline, menu } = await mountResolved('qa_member', SHIPPED_HEADER, 'page');
    const drawn = [...inline, ...menu].filter((l) =>
      ACTIONS.some((a) => a.label === l),
    );
    expect(drawn).toEqual(['Ban User', 'Open Profile', 'Impersonate User', 'Copy Profile Link']);
  });

  it('an authored list without the key draws exactly that list (#11592)', async () => {
    const { inline, menu } = await mountResolved(
      'qa_member',
      { type: 'page:header', properties: { actions: ['ban_user'] } },
      'page',
    );
    const drawn = [...inline, ...menu].filter((l) => ACTIONS.some((a) => a.label === l));
    expect(drawn).toEqual(['Ban User']);
  });

  it('refuses placedActions: true beside a list: none of the object\'s actions draws, reported once', async () => {
    mount('qa_refused', { type: 'page:header', properties: { placedActions: true, actions: ['ban_user'] } }, 'page');
    await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
    await waitFor(() =>
      expect(consoleError.mock.calls.some((c) => String(c[0]).includes('`placedActions: true` refused'))).toBe(true),
    );
    const { inline, menu } = await headerFaces();
    expect([...inline, ...menu].filter((l) => ACTIONS.some((a) => a.label === l))).toEqual([]);
    expect(
      consoleError.mock.calls.filter((c) => String(c[0]).includes('`placedActions: true` refused')),
    ).toHaveLength(1);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36150 — an authored record page is drawn on the desktop full
 * page only. On a phone and in the side drawer (an embedded view) the record
 * draws the platform's standard page, built from the object's metadata.
 *
 * Read through the real `RecordDetailView`, as the Console mounts it: the full
 * page by its route (at desktop and phone widths), and the drawer as
 * `ObjectView` mounts it (`embedded`, the object and record handed in).
 *
 *   - The card's pin: an authored `kind: 'full'` page draws on the desktop full
 *     page; on a phone and in the drawer its page-only block is gone, the
 *     standard page's tab strip is drawn, and the object's `record_more`
 *     action is still in the header's ⋯ menu. Red before the change (the
 *     authored page drew on all three).
 *   - CONTROL: an object with no authored page draws the standard page on all
 *     three, as before.
 *   - The host's exceptions, each on the drawer and the phone: a slotted
 *     page's slot is kept (it IS the standard page); the approval request and
 *     user pages keep their own page; a page named in the URL is drawn on the
 *     phone.
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
import { RECORD_NAMED_PAGE_ROUTE } from '../console/AppContent';
import { authoredRecordPageApplies, OBJECTS_KEEPING_AUTHORED_PAGE } from './recordPageSurface';

const RECORD_ID = 'rec-1';
const AUTHORED_MARK = 'Authored page block';
const SLOT_MARK = 'Slotted alert';

const MORE_ACTION = { name: 'qa_recalc', label: 'Recalculate', type: 'api', target: '/api/v1/x', locations: ['record_section', 'record_more'] };

function objectDef(name: string) {
  return {
    name,
    label: name,
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    actions: [MORE_ACTION],
  };
}

function fullPage(object: string, name = `${object}_detail`, isDefault = true) {
  return {
    name,
    label: 'Detail',
    type: 'record',
    object,
    kind: 'full',
    ...(isDefault ? { isDefault: true } : {}),
    regions: [{
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header', properties: { actions: [] } },
        { type: 'element:text', properties: { content: AUTHORED_MARK } },
        { type: 'record:details', properties: {} },
      ],
    }],
  };
}

function slottedPage(object: string) {
  return {
    name: `${object}_detail`,
    label: 'Detail',
    type: 'record',
    object,
    kind: 'slotted',
    isDefault: true,
    regions: [],
    slots: { alerts: [{ type: 'record:alert', id: 'qa_alert', properties: { severity: 'info', title: SLOT_MARK } }] },
  };
}

type Face = 'desktop' | 'phone' | 'drawer';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

function mount(objectName: string, pages: unknown[], face: Face, url?: string) {
  setWidth(face === 'phone' ? 375 : 1280);
  const objects = [objectDef(objectName)];
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
  const page = <RecordDetailView dataSource={dataSource} objects={objects} onEdit={vi.fn()} />;
  const view =
    face === 'drawer' ? (
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
    ) : (
      <MemoryRouter initialEntries={[url ?? `/apps/a/${objectName}/record/${RECORD_ID}`]}>
        <Routes>
          <Route path="/apps/:appName">
            <Route path=":objectName/record/:recordId" element={page} />
            <Route path={RECORD_NAMED_PAGE_ROUTE} element={page} />
          </Route>
        </Routes>
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

/** Wait for the record to draw (its name in the details). */
async function recordDrawn() {
  await waitFor(() => expect(screen.getAllByText('Ada').length).toBeGreaterThan(0));
}

/** Whether the page draws the standard page's tab strip. */
function standardTabs(): boolean {
  return document.querySelector('[data-record-tab-row]') !== null || screen.queryAllByRole('tab').length > 0;
}

let consoleError: MockInstance<typeof console.error>;
const originalWidth = window.innerWidth;

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
  setWidth(originalWidth);
});

describe('authoredRecordPageApplies (objectstack#36150)', () => {
  it('applies on the desktop full page only', () => {
    expect(authoredRecordPageApplies({ embedded: false, phone: false, objectName: 'qa_project', requestedPageName: undefined })).toBe(true);
    expect(authoredRecordPageApplies({ embedded: true, phone: false, objectName: 'qa_project', requestedPageName: undefined })).toBe(false);
    expect(authoredRecordPageApplies({ embedded: false, phone: true, objectName: 'qa_project', requestedPageName: undefined })).toBe(false);
    expect(authoredRecordPageApplies({ embedded: true, phone: true, objectName: 'qa_project', requestedPageName: undefined })).toBe(false);
  });

  it('a page named in the URL applies wherever its route renders', () => {
    expect(authoredRecordPageApplies({ embedded: false, phone: true, objectName: 'qa_project', requestedPageName: 'qa_print' })).toBe(true);
  });

  it('the approval request and user pages apply on every surface, and no other object does', () => {
    expect([...OBJECTS_KEEPING_AUTHORED_PAGE].sort()).toEqual(['sys_approval_request', 'sys_user']);
    for (const objectName of OBJECTS_KEEPING_AUTHORED_PAGE) {
      expect(authoredRecordPageApplies({ embedded: true, phone: false, objectName, requestedPageName: undefined })).toBe(true);
      expect(authoredRecordPageApplies({ embedded: false, phone: true, objectName, requestedPageName: undefined })).toBe(true);
    }
  });
});

describe('#36150 an authored full page', () => {
  it('draws as authored on the desktop full page', async () => {
    mount('qa_project', [fullPage('qa_project')], 'desktop');
    await recordDrawn();
    await waitFor(() => expect(screen.getByText(AUTHORED_MARK)).toBeInTheDocument());
    expect(standardTabs()).toBe(false);
  });

  it.each<Face>(['phone', 'drawer'])('draws the standard page on the %s', async (face) => {
    mount('qa_project', [fullPage('qa_project')], face);
    await recordDrawn();
    await waitFor(() => expect(standardTabs()).toBe(true));
    expect(screen.queryByText(AUTHORED_MARK)).toBeNull();
  });

  it('on the drawer the object\'s record_more action is in the standard header\'s ⋯ menu', async () => {
    mount('qa_project', [fullPage('qa_project')], 'drawer');
    await recordDrawn();
    const trigger = await screen.findByRole('button', { name: 'More actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
    const rows = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]')).map((e) => (e.textContent ?? '').trim());
    expect(rows).toContain('Recalculate');
  });
});

describe('#36150 CONTROL — no authored page', () => {
  it.each<Face>(['desktop', 'phone', 'drawer'])('the standard page on the %s, as before', async (face) => {
    mount('qa_plain', [], face);
    await recordDrawn();
    await waitFor(() => expect(standardTabs()).toBe(true));
  });
});

describe('#36150 the host\'s exceptions', () => {
  it.each<Face>(['desktop', 'phone', 'drawer'])('a slotted page keeps its slot on the %s', async (face) => {
    mount('qa_slotted', [slottedPage('qa_slotted')], face);
    await recordDrawn();
    await waitFor(() => expect(screen.getByText(SLOT_MARK)).toBeInTheDocument());
  });

  it.each<[string, Face]>([
    ['sys_approval_request', 'phone'],
    ['sys_approval_request', 'drawer'],
    ['sys_user', 'phone'],
    ['sys_user', 'drawer'],
  ])('%s keeps its own page on the %s', async (objectName, face) => {
    mount(objectName, [fullPage(objectName)], face);
    await waitFor(() => expect(screen.getByText(AUTHORED_MARK)).toBeInTheDocument());
  });

  it('a page named in the URL is drawn on the phone', async () => {
    mount(
      'qa_project',
      [fullPage('qa_project'), fullPage('qa_project', 'qa_named', false)],
      'phone',
      `/apps/a/qa_project/record/${RECORD_ID}/page/qa_named`,
    );
    await waitFor(() => expect(screen.getByText(AUTHORED_MARK)).toBeInTheDocument());
  });
});

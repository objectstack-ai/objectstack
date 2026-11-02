// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29074 — on a phone a list pushes a record page over itself, and
 * marks the push as a related row does (`recordPagePushState`). The record
 * page reads that marker on a phone (`isRecordPagePushed`) and its 「‹」 goes
 * back in the history, so Back after it pops cleanly instead of leaving a
 * second copy of the list on the stack.
 *
 * The controls: a desktop list's state is unchanged, and a phone's answer to
 * a drawer link (`?recordId=`), which replaces the list's entry, is not
 * marked, since there is no list below it to go back to.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type Location } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { useObjectViewRecordNavigation } from './objectViewRecordNavigation';
import { useObjectViewPluginSchema } from './objectViewPluginSchema';
import { isRecordPagePushed, recordPagePushState, RECORD_PAGE_PUSHED_STATE } from './recordPagePush';
import { RecordDetailView } from './RecordDetailView';

const ROWS = [{ id: 'r-1' }, { id: 'r-2' }];
const LIST = { pathname: '/apps/crm/crm_lead', search: '?view=all', state: null, hash: '', key: 'k' } as Location;

function hookInputs(navigate: ReturnType<typeof useNavigate>, phone: boolean, search = 'view=all', appName = 'crm') {
  return {
    activeView: { id: 'all', name: 'all', label: 'All leads' } as never,
    objectDef: { name: 'crm_lead', label: 'Lead', fields: {}, navigation: { mode: 'page' } } as never,
    objects: [{ name: 'crm_lead', label: 'Lead' }] as never,
    appName,
    viewId: undefined,
    searchParams: new URLSearchParams(search),
    setSearchParams: vi.fn(),
    location: { ...LIST, search: `?${search}` } as Location,
    navigate,
    routerRootHref: '/',
    servedViews: { views: [], objects: [] } as never,
    viewLabel: (_object: string, _view: string, fallback: string) => fallback,
    unlabelledViewText: 'Untitled view',
    language: 'en',
    recordOpenPreference: 'object' as never,
    phone,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/apps/crm/crm_lead?view=all']}>{children}</MemoryRouter>
);

const lastState = (navigate: ReturnType<typeof vi.fn>) => navigate.mock.calls.at(-1)![1].state;

describe('a list marks the record page it pushes on a phone (objectstack#29074)', () => {
  it('a phone row click pushes the page with the list as its origin and the pushed marker', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useObjectViewRecordNavigation(hookInputs(navigate, true)), { wrapper });
    act(() => result.current.handleListRowsChange(ROWS));
    act(() => result.current.handleRowClick({ id: 'r-2' }));
    expect(navigate.mock.calls[0][0]).toBe('record/r-2');
    expect(navigate.mock.calls[0][1].replace).toBeFalsy();
    const state = lastState(navigate);
    expect(state.from).toEqual({ pathname: '/apps/crm/crm_lead?view=all', label: 'All leads', siblings: ['r-1', 'r-2'] });
    expect(isRecordPagePushed(state)).toBe(true);
  });

  it('control: a desktop row click carries no marker', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useObjectViewRecordNavigation(hookInputs(navigate, false)), { wrapper });
    act(() => result.current.handleRowClick({ id: 'r-2' }));
    expect(lastState(navigate)).not.toHaveProperty(RECORD_PAGE_PUSHED_STATE);
  });

  it('control: a phone answering a drawer link replaces the list entry and carries no marker', () => {
    const navigate = vi.fn();
    renderHook(() => useObjectViewRecordNavigation(hookInputs(navigate, true, 'view=all&recordId=r-1')), { wrapper });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][1].replace).toBe(true);
    expect(isRecordPagePushed(lastState(navigate))).toBe(false);
  });

  it('a plugin view (kanban, calendar, …) marks its row push the same way', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useObjectViewPluginSchema({
        views: [{ id: 'all', name: 'all', label: 'All leads', type: 'kanban' }] as never,
        activeViewId: 'all',
        viewDraft: null,
        activeView: { id: 'all', name: 'all', label: 'All leads', type: 'kanban' } as never,
        objectDef: { name: 'crm_lead', label: 'Lead', fields: {} } as never,
        onEdit: vi.fn(),
        isAdmin: false,
        location: LIST,
        navigate,
        viewId: undefined,
        servedViews: { views: [], objects: [] } as never,
        viewLabel: (_object: string, _view: string, fallback: string) => fallback,
        unlabelledViewText: 'Untitled view',
        language: 'en',
      }),
      { wrapper },
    );
    act(() => (result.current.objectViewSchema as { onNavigate: (id: string, mode: 'view') => void }).onNavigate('r-1', 'view'));
    const state = lastState(navigate);
    expect(state.from.pathname).toBe('/apps/crm/crm_lead?view=all');
    expect(isRecordPagePushed(state)).toBe(true);
  });
});

/**
 * The history the marker buys, on the real record page at 390 px. Home → the
 * lead list → a row → the page's 「‹」 → Back: 「‹」 returns to the list entry
 * and Back leaves the list for home; the record is never reopened. The page
 * still names its way back by the object's plural (Target 3, objectstack#27058).
 */
const APP = 'demo';
const LEAD = 'crm_lead';
const OBJECTS = [
  {
    name: LEAD,
    label: 'Lead',
    pluralLabel: 'Leads',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    navigation: { mode: 'page' },
  },
];

function ListRoute({ phone }: { phone: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useObjectViewRecordNavigation({ ...hookInputs(navigate, phone, 'view=all', APP), objectDef: OBJECTS[0] as never, location });
  return <button type="button" data-testid="row" onClick={() => nav.handleRowClick({ id: 'r-1' })}>row</button>;
}

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{`${location.pathname}${location.search}`}</output>
      <button type="button" data-testid="browser-back" onClick={() => navigate(-1)}>browser back</button>
    </>
  );
}

function mountHistory(entries: Array<string | { pathname: string; search?: string; state?: unknown }>, phone = true) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async (_object: string, id: string) => ({ id, name: id === 'L-1' ? 'Mira Costa' : 'Theo Park' })),
    create: vi.fn(),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  const metadata = {
    objects: OBJECTS, pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  render(
    <MemoryRouter initialEntries={entries as never} initialIndex={entries.length - 1}>
      <MetadataCtx.Provider value={metadata}>
        <Routes>
          <Route path="/home" element={<div />} />
          <Route path={`/apps/${APP}/${LEAD}`} element={<ListRoute phone={phone} />} />
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={dataSource as never} objects={OBJECTS as never} onEdit={() => {}} />}
          />
        </Routes>
        <Where />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const backLink = () => document.querySelector('[data-record-page-root] > [data-record-top-bar] [data-record-crumb-back]') as HTMLElement | null;

describe('the record page a phone list pushes (objectstack#29074)', () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    RelatedCountStore._reset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 800, width: 390, height: 800, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
  });

  it('「‹ Leads」 goes back to the list entry, and Back then leaves the list for home', async () => {
    mountHistory(['/home', `/apps/${APP}/${LEAD}?view=all`]);
    fireEvent.click(screen.getByTestId('row'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-1`), { timeout: 5000 });
    await waitFor(() => expect(backLink()).toBeTruthy(), { timeout: 5000 });
    expect(backLink()!.tagName).toBe('BUTTON');
    expect(backLink()!.textContent).toBe('Leads');
    fireEvent.click(backLink()!);
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}?view=all`));
    fireEvent.click(screen.getByTestId('browser-back'));
    await waitFor(() => expect(where()).toBe('/home'));
  });

  it('control, the push unmarked (a desktop list): 「‹」 is a link that replaces the record (#29210), so the list sits twice and Back stays on it', async () => {
    mountHistory(['/home', `/apps/${APP}/${LEAD}?view=all`], false);
    fireEvent.click(screen.getByTestId('row'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-1`), { timeout: 5000 });
    await waitFor(() => expect(backLink()).toBeTruthy(), { timeout: 5000 });
    expect(backLink()!.tagName).toBe('A');
    expect(backLink()!.textContent).toBe('Leads');
    fireEvent.click(backLink()!);
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}?view=all`));
    // The record's entry was replaced by a second copy of the list: Back
    // lands on the first copy, and only a second Back reaches home. The
    // marked push above reaches home in one.
    fireEvent.click(screen.getByTestId('browser-back'));
    await waitFor(() => expect(screen.getByTestId('row')).toBeTruthy());
    expect(where()).toBe(`/apps/${APP}/${LEAD}?view=all`);
    fireEvent.click(screen.getByTestId('browser-back'));
    await waitFor(() => expect(where()).toBe('/home'));
  });

  it('a lead pushed from another lead\'s page still reads that record, not the plural', async () => {
    const parent = `/apps/${APP}/${LEAD}/record/L-1`;
    mountHistory([parent, { pathname: `/apps/${APP}/${LEAD}/record/r-2`, state: recordPagePushState({ pathname: parent, search: '' }, 'Mira Costa') }]);
    await waitFor(() => expect(backLink()).toBeTruthy(), { timeout: 5000 });
    expect(backLink()!.tagName).toBe('BUTTON');
    expect(backLink()!.textContent).toBe('Mira Costa');
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27058 — the record page on a phone, from a real
 * `RecordDetailView` mount at 390 px (the `topBar-27524` harness):
 *
 *  - Target 3, the top bar: one way back, 「‹ <object plural>」 on a top-level
 *    page, to the list the page came from; the counter and ↓ ↑ when the page
 *    knows its rows; no ⊟ (the stack has no right column), no ⤡ (no drawer
 *    to collapse to);
 *  - Target 4, the header: the subtitle from the first two declared text
 *    highlights (the strip of four that followed is gone since
 *    objectstack#35891);
 *  - Target 7, the bottom bar: the header's actions drawn below the body, in
 *    their bar face — the host's Edit, the primary and the `⋯`, however many
 *    actions the page declares (objectstack#34595; this file pinned Edit
 *    after the declared actions before); the header draws no action row of
 *    its own;
 *  - Target 8, a page pushed from its parent's related row: its 「‹」 names
 *    where it returns, the parent record (「‹ Mira Costa」), and it and the
 *    path row's parent go back in the history, to the parent, whose own 「‹」
 *    reads the object plural again;
 *  - a page under a `?from=` trail opened from a link goes back by link,
 *    its 「‹」 named by the parent too (its short id when the trail has no
 *    title);
 *  - control: at 1440 px the page keeps its desktop bar (⊟) and the header
 *    its own action row, and no bottom bar is mounted.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';
import { recordPagePushState } from './recordPagePush';

const APP = 'demo';
const LEAD = 'crm_lead';
const TASK = 'crm_task';
const ROWS = ['r-1', 'r-2', 'r-3'];

const action = (name: string, label: string) => ({
  name,
  label,
  type: 'api',
  target: '/api/v1/noop',
  locations: ['record_header'],
});

function objectsWith(actions: unknown[]) {
  return [
    {
      name: LEAD,
      label: 'Lead',
      pluralLabel: 'Leads',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        company: { type: 'text', label: 'Company' },
        title: { type: 'text', label: 'Title' },
        email: { type: 'email', label: 'Email' },
        status: { type: 'select', label: 'Status', options: [{ value: 'new', label: 'New' }] },
        phone: { type: 'phone', label: 'Phone' },
        city: { type: 'text', label: 'City' },
        website: { type: 'url', label: 'Website' },
      },
      // The title field first: it is the page's name, never a highlight.
      highlightFields: ['name', 'company', 'title', 'email', 'status', 'phone', 'city', 'website'],
      actions,
    },
    {
      name: TASK,
      label: 'Task',
      pluralLabel: 'Tasks',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        lead: { type: 'lookup', reference: LEAD, label: 'Lead' },
      },
    },
  ];
}

const LEAD_ROW = {
  name: 'Mira Costa',
  company: 'Atlas Construction',
  title: 'Director of Sales',
  email: 'mira@atlas.test',
  status: 'new',
  phone: '555-0100',
  city: 'Austin',
  website: 'https://atlas.test',
};

let rootWidth = 390;

function setWidth(width: number) {
  rootWidth = width;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (objectName: string, recordId: string) =>
      objectName === LEAD ? { id: recordId, ...LEAD_ROW } : { id: recordId, name: `Task ${recordId}`, lead: 'L-1' },
    ),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

function metadataFor(objects: unknown[]) {
  return {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as never;
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

/** The browser's Back button: one step back in the history. */
function HistoryBack() {
  const navigate = useNavigate();
  return <button type="button" data-testid="history-back" onClick={() => navigate(-1)} />;
}

type Entry = string | { pathname: string; search?: string; state?: unknown };

function mountPage(entries: Entry[], objects = objectsWith([action('convert', 'Convert Lead'), action('assign', 'Assign')])) {
  const dataSource = makeDataSource();
  render(
    <MemoryRouter initialEntries={entries as never} initialIndex={entries.length - 1}>
      <MetadataCtx.Provider value={metadataFor(objects)}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={dataSource as never} objects={objects} onEdit={() => {}} />}
          />
          <Route path="/apps/:appName/:objectName" element={<div data-testid="list" />} />
        </Routes>
        <Where />
        <HistoryBack />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  return dataSource;
}

const where = () => screen.getByTestId('where').textContent;
const pageBar = () => document.querySelector('[data-record-page-root] > [data-record-top-bar]') as HTMLElement | null;
const actionBar = () => document.querySelector('[data-record-action-bar]') as HTMLElement | null;
const barButtons = () =>
  Array.from(actionBar()!.querySelectorAll('[role="toolbar"] > button, [role="toolbar"] > [data-disabled-reason] > button'))
    .map((b) => b.getAttribute('aria-label') || b.textContent?.trim());

async function barDrawn(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const toolbar = actionBar()?.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      return toolbar as HTMLElement;
    },
    { timeout: 5000 },
  );
}

async function moreItems(): Promise<string[]> {
  fireEvent.pointerDown(within(actionBar()!).getByRole('button', { name: 'More actions' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  const menu = await screen.findByRole('menu');
  return within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
}

beforeEach(() => {
  cleanup();
  setWidth(390);
  window.localStorage.clear();
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
    const width = rootWidth;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, width, height: 800, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setWidth(1440);
});

describe('the record page on a phone (objectstack#27058)', () => {
  it('opened from its list: 「‹ Leads」 back to the list, the counter and ↓ ↑, no ⊟ and no ⤡', async () => {
    mountPage([
      { pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from: { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS } } },
    ]);
    await barDrawn();
    const bar = pageBar()!;
    const back = bar.querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
    expect(back.tagName).toBe('A');
    expect(back.textContent).toBe('Leads');
    expect(back.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);
    expect(bar.querySelector('[data-record-top-bar-position]')?.textContent).toBe('1 / 3');
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
    expect(screen.queryByTestId('record-drawer-return')).toBeNull();
    // No breadcrumb, no path row: the record's name is the header title.
    expect(screen.queryByTestId('record-page-crumb')).toBeNull();
    expect(screen.queryByTestId('record-page-path')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));
    fireEvent.click(pageBar()!.querySelector('[data-record-crumb-back]')!);
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}`));
  });

  // objectstack#29071 — 「‹」 replaces the record's history entry: the
  // browser's Back afterwards leaves for the entry below, never the record.
  it('「‹」 does not leave the record behind it in the history', async () => {
    mountPage([
      `/apps/${APP}/home`,
      `/apps/${APP}/${LEAD}`,
      { pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from: { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS } } },
    ]);
    await barDrawn();
    fireEvent.click(pageBar()!.querySelector('[data-record-crumb-back]')!);
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}`));
    fireEvent.click(screen.getByTestId('history-back'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}`));
    expect(document.querySelector('[data-record-page-root]')).toBeNull();
    fireEvent.click(screen.getByTestId('history-back'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/home`));
  });

  it('opened directly: 「‹ Leads」 to the object\'s list, and no counter', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    await barDrawn();
    const back = pageBar()!.querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
    expect(back.textContent).toBe('Leads');
    expect(back.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);
    expect(pageBar()!.querySelector('[data-record-top-bar-position]')).toBeNull();
  });

  it('the header: the subtitle from the first two declared text highlights; no strip under it (objectstack#35891)', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    const subtitle = await waitFor(
      () => {
        const el = document.querySelector('[data-page-header-subtitle="host"]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(subtitle.textContent).toBe('Atlas Construction · Director of Sales');
    // Until objectstack#35891 a strip of four highlights (Email, Status,
    // Phone, City) followed. The default page draws no strip now, on a phone
    // as on a desktop; those fields read in their groups.
    expect(document.querySelector('[data-highlights-face]')).toBeNull();
    await waitFor(() => expect(document.body.textContent).toContain('mira@atlas.test'));
    expect(document.body.textContent).toContain('Austin');
  });

  it('the bottom bar: [Edit][Convert Lead][⋯] with the declared second action in the ⋯; the header draws no action row (objectstack#34595)', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    const toolbar = await barDrawn();
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('bar');
    expect(barButtons()).toEqual(['Edit', 'Convert Lead', 'More actions']);
    // The header above the body has no toolbar of its own, and the bar is
    // below the body, not in it.
    const header = document.querySelector('[data-record-page-root] header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(within(header).queryByRole('toolbar')).toBeNull();
    expect(header.contains(actionBar())).toBe(false);
    expect(actionBar()!.contains(header)).toBe(false);
    const items = await moreItems();
    expect(items).toContain('Assign');
    expect(items).not.toContain('Edit');
  });

  it('the bottom bar with one declared action: [Edit][Convert Lead][⋯] (objectstack#34595)', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], objectsWith([action('convert', 'Convert Lead')]));
    await barDrawn();
    const buttons = barButtons();
    expect(buttons.slice(0, 2)).toEqual(['Edit', 'Convert Lead']);
    expect(buttons.length).toBeLessThanOrEqual(3);
  });

  it('a page pushed from its parent\'s related row: 「‹ Mira Costa」 goes back to the parent, whose 「‹」 reads 「Leads」', async () => {
    const trail = encodeURIComponent(JSON.stringify([{ o: LEAD, i: 'L-1', t: 'Mira Costa' }]));
    const parent = `/apps/${APP}/${LEAD}/record/L-1`;
    const pushed = {
      pathname: `/apps/${APP}/${TASK}/record/T-1`,
      search: `?from=${trail}`,
      state: recordPagePushState({ pathname: parent, search: '' }, 'Mira Costa', ['T-1', 'T-2', 'T-3']),
    };
    mountPage([parent, pushed]);
    const path = await screen.findByTestId('record-page-path', undefined, { timeout: 5000 });
    expect(path.textContent).toBe('Lead Mira CostaTask');
    const back = pageBar()!.querySelector('[data-record-crumb-back]') as HTMLElement;
    expect(back.tagName).toBe('BUTTON');
    // One level down the way back is named by where it returns (Target 8).
    expect(back.textContent).toBe('Mira Costa');
    expect(pageBar()!.querySelector('[data-record-top-bar-position]')?.textContent).toBe('1 / 3');

    fireEvent.click(back);
    await waitFor(() => expect(where()).toBe(parent));
    // Back on the top-level parent page, Target 3's object plural.
    await waitFor(() => expect(screen.queryByTestId('record-page-path')).toBeNull());
    expect(pageBar()!.querySelector('[data-record-crumb-back]')!.textContent).toBe('Leads');
  });

  it('the path row\'s parent of a pushed page goes back too', async () => {
    const trail = encodeURIComponent(JSON.stringify([{ o: LEAD, i: 'L-1', t: 'Mira Costa' }]));
    const parent = `/apps/${APP}/${LEAD}/record/L-1`;
    mountPage([
      parent,
      {
        pathname: `/apps/${APP}/${TASK}/record/T-1`,
        search: `?from=${trail}`,
        state: recordPagePushState({ pathname: parent, search: '' }, 'Mira Costa'),
      },
    ]);
    const path = await screen.findByTestId('record-page-path', undefined, { timeout: 5000 });
    fireEvent.click(within(path).getByRole('button', { name: /Mira Costa/ }));
    await waitFor(() => expect(where()).toBe(parent));
  });

  it('a ?from= page opened from a link: 「‹ Mira Costa」 and the path row link to the parent page', async () => {
    const trail = encodeURIComponent(JSON.stringify([{ o: LEAD, i: 'L-1', t: 'Mira Costa' }]));
    mountPage([`/apps/${APP}/${TASK}/record/T-1?from=${trail}`]);
    const path = await screen.findByTestId('record-page-path', undefined, { timeout: 5000 });
    const ancestor = path.querySelector('a')!;
    expect(ancestor.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}/record/L-1`);
    const back = pageBar()!.querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
    expect(back.tagName).toBe('A');
    expect(back.textContent).toBe('Mira Costa');
    expect(back.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}/record/L-1`);
  });

  it('a ?from= trail with no title: the 「‹」 names the parent by its short id', async () => {
    const trail = encodeURIComponent(JSON.stringify([{ o: LEAD, i: 'L-1' }]));
    mountPage([`/apps/${APP}/${TASK}/record/T-1?from=${trail}`]);
    await screen.findByTestId('record-page-path', undefined, { timeout: 5000 });
    const back = pageBar()!.querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
    expect(back.textContent).toBe('#L-1');
  });

  it('control: at 1440 px the desktop bar and the header\'s own action row, no bottom bar', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    await screen.findByTestId('record-page-crumb', undefined, { timeout: 5000 });
    // objectstack#35890 — the rail's ⊟ is retired with it.
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
    expect(actionBar()).toBeNull();
    // objectstack#35593 — the header's row is the page's one top row: its
    // group sits in the top bar's action slot.
    const toolbar = await waitFor(() => {
      const header = document.querySelector('[data-record-top-bar-actions]') as HTMLElement;
      const el = within(header).getByRole('toolbar');
      return el;
    });
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('row');
    expect(within(toolbar).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(document.querySelector('[data-page-header-subtitle="host"]')).toBeNull();
    expect(screen.getByTestId('record-page-crumb')).toBeTruthy();
  });
});

/**
 * objectstack#35016 — one `⋯` per screen on a record pending the reader's
 * approval, and no unpressable action in the phone bar's first slot.
 *
 *  - desktop: the header's ONE group holds the page's one `⋯`, the other
 *    approval levers first in it (objectstack#35593: no band of its own);
 *  - phone, approval-locked: the bar is the same group, Approve the only
 *    filled button and pressable; an approval lock draws no Edit
 *    (objectstack#35593, #35419);
 *  - control: the same page with no request keeps [Edit][Convert Lead][⋯].
 */
const APPROVAL_OBJECT = 'sys_approval_request';
const REQUEST_ID = 'req-35016';
const APPROVAL_DEF = {
  name: APPROVAL_OBJECT,
  label: 'Approval Request',
  fields: { id: { type: 'text', label: 'Id' }, status: { type: 'text', label: 'Status' } },
  actions: [
    { name: 'approval_approve', label: 'Approve', variant: 'primary', type: 'api', method: 'POST', target: '/api/v1/approvals/requests/{id}/approve', visible: 'record.viewer.can_act', locations: ['record_section'] },
    { name: 'approval_reject', label: 'Reject', variant: 'danger', type: 'api', method: 'POST', target: '/api/v1/approvals/requests/{id}/reject', visible: 'record.viewer.can_act', locations: ['record_section'] },
    { name: 'approval_reassign', label: 'Reassign', type: 'api', method: 'POST', target: '/api/v1/approvals/requests/{id}/reassign', visible: 'record.viewer.can_act', locations: ['record_section'] },
    { name: 'approval_send_back', label: 'Send back', type: 'api', method: 'POST', target: '/api/v1/approvals/requests/{id}/revise', visible: 'record.viewer.can_act', locations: ['record_section'] },
    { name: 'approval_request_info', label: 'Request info', type: 'api', method: 'POST', target: '/api/v1/approvals/requests/{id}/request-info', visible: 'record.viewer.can_act', locations: ['record_section'] },
  ],
};
const PENDING_REQUEST = {
  id: REQUEST_ID,
  process_name: 'flow:lead_review',
  object_name: LEAD,
  record_id: 'r-1',
  status: 'pending',
  submitter_id: 'u2',
  current_step: 'review',
  pending_approvers: ['u1'],
  lock_record: true,
  viewer: { can_act: true, is_submitter: false, can_override: false },
};

function stubApprovals(request: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (request && u.includes(`/approvals/requests/${REQUEST_ID}/actions`)) return json({ data: [] });
      if (request && u.endsWith(`/approvals/requests/${REQUEST_ID}`)) return json(request);
      if (u.includes('/approvals/requests?object=')) return json({ data: request ? [request] : [] });
      if (u.includes('/lock')) return json({ locked: !!request });
      return json({ data: [] });
    }),
  );
}

function mountApprovalPage(pageObjects: unknown[] = objectsWith([action('convert', 'Convert Lead'), action('assign', 'Assign')])) {
  const objects = [...pageObjects, APPROVAL_DEF];
  const metadata = {
    ...(metadataFor(objects) as object),
    getItem: async (type: string, name: string) => (type === 'object' && name === APPROVAL_OBJECT ? APPROVAL_DEF : null),
  } as never;
  render(
    <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}/record/r-1`]}>
      <MetadataCtx.Provider value={metadata}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={makeDataSource() as never} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** Every drawn control whose face is the `⋯` glyph. */
const ellipsisTriggers = () =>
  Array.from(document.querySelectorAll('button')).filter((b) => b.querySelector('svg.lucide-ellipsis, svg.lucide-more-horizontal'));

describe('one ⋯ per screen on a record pending approval (objectstack#35016)', () => {
  beforeEach(() => {
    __resetRecordApprovalsStore();
  });

  // objectstack#35593 — the band is gone: the decisions are the header's ONE
  // group, and its one ⋮ holds the other levers, then the record's actions.
  it('desktop: exactly one ⋯, the header group\'s, holding the other levers, a separator, then the record\'s actions', async () => {
    setWidth(1440);
    stubApprovals(PENDING_REQUEST);
    mountApprovalPage();
    const more = await screen.findByTestId('declared-actions-header-menu', undefined, { timeout: 5000 });
    expect(more.closest('[data-record-top-bar-actions]')).toBeTruthy();
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
    expect(ellipsisTriggers()).toEqual([more]);
    const row = more.closest('[role="toolbar"]') as HTMLElement;
    const buttons = Array.from(row.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.textContent?.trim());
    expect(buttons).toEqual(['Approve', 'Reject', 'More actions']);
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items.slice(0, 3)).toEqual(['Reassign', 'Send back', 'Request info']);
    expect(items).toContain('Convert Lead');
    expect(items).not.toContain('Edit');
    expect(within(menu).getByTestId('declared-actions-header-menu-separator')).toBeTruthy();
  });

  // objectstack#35593 / #35419 — on a phone the bar draws the same group:
  // Approve, the ONLY filled button, Reject outlined, and the one ⋮.
  it('phone, pending on me: the bar is [Approve][Reject][⋯], Approve the only filled button, no Edit', async () => {
    stubApprovals(PENDING_REQUEST);
    mountApprovalPage();
    await barDrawn();
    await waitFor(() => expect(barButtons()).toEqual(['Approve', 'Reject', 'More actions']));
    const approve = within(actionBar()!).getByTestId('declared-action-approval_approve');
    const reject = within(actionBar()!).getByTestId('declared-action-approval_reject');
    expect(approve.getAttribute('data-header-tone')).toBe('primary');
    expect(reject.getAttribute('data-header-tone')).toBe('secondary');
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    expect(ellipsisTriggers()).toHaveLength(1);
    fireEvent.pointerDown(within(actionBar()!).getByRole('button', { name: 'More actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items.slice(0, 3)).toEqual(['Reassign', 'Send back', 'Request info']);
    expect(items).not.toContain('Edit');
  });

  it('control: no request, the bar keeps [Edit][Convert Lead][⋯] with Edit pressable', async () => {
    stubApprovals(null);
    mountApprovalPage();
    await barDrawn();
    expect(barButtons()).toEqual(['Edit', 'Convert Lead', 'More actions']);
    const first = actionBar()!.querySelector('[role="toolbar"] button') as HTMLButtonElement;
    expect(first.disabled).toBe(false);
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
  });
});

/**
 * objectstack#35099 — the phone bar's first slot goes to a pressable action
 * whatever turns Edit off, not only the approval lock (objectstack#35016,
 * pinned above):
 *
 *  - `userActions.edit.disabledWhen` holding on the record;
 *  - `editLockedByState` — every field the edit form shows read-only by its
 *    `readonlyWhen` — with its badge still drawn as the reason;
 *
 * each time Edit sits in the bar's `⋯`, still drawn and still off, and the
 * first declared action leads the bar. Controls: the desktop row keeps Edit
 * greyed in place for all three reasons, and a `disabledWhen` that does not
 * hold leaves Edit leading the bar, pressable.
 */
const LOCKS_NEW = "record.status == 'new'";

/** The fixtures' object list, widened by one key the page reads; `mountPage` only passes it through. */
type PageObjects = Parameters<typeof mountPage>[1];

function leadWithDisabledEdit(when: string): PageObjects {
  const [lead, ...rest] = objectsWith([action('convert', 'Convert Lead'), action('assign', 'Assign')]);
  return [{ ...lead, userActions: { edit: { disabledWhen: when } } }, ...rest] as never;
}

function leadLockedByState(): PageObjects {
  const [lead, ...rest] = objectsWith([action('convert', 'Convert Lead'), action('assign', 'Assign')]);
  const fields = Object.fromEntries(
    Object.entries(lead.fields).map(([name, def]) => [name, name === 'id' ? def : { ...def, readonlyWhen: LOCKS_NEW }]),
  );
  return [{ ...lead, fields }, ...rest] as never;
}

/** The desktop header row's Edit, read before any menu opens. */
async function desktopRowEdit(): Promise<HTMLButtonElement> {
  return waitFor(
    () => {
      // The header's group, in the page's one top row (objectstack#35593).
      const header = document.querySelector('[data-record-top-bar-actions]') as HTMLElement | null;
      expect(header).toBeTruthy();
      const row = within(header!).getByRole('toolbar');
      const edit = within(row).getAllByRole('button').find((b) => b.textContent?.trim() === 'Edit');
      expect(edit).toBeTruthy();
      return edit as HTMLButtonElement;
    },
    { timeout: 5000 },
  );
}

async function expectEditInBarOverflowOff() {
  await barDrawn();
  await waitFor(() => expect(barButtons()).toEqual(['Convert Lead', 'Assign', 'More actions']));
  const first = actionBar()!.querySelector('[role="toolbar"] button') as HTMLButtonElement;
  expect(first.disabled).toBe(false);
  fireEvent.pointerDown(within(actionBar()!).getByRole('button', { name: 'More actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  // By accessible name: an entry that says why it is off carries the reason
  // as a second line, and its name stays the label (objectstack#35135).
  const edit = within(menu).getByRole('menuitem', { name: 'Edit' });
  expect(edit.getAttribute('aria-disabled')).toBe('true');
}

describe('a phone bar never leads with an Edit that is off, for any reason (objectstack#35099)', () => {
  beforeEach(() => {
    __resetRecordApprovalsStore();
  });

  it('phone, edit.disabledWhen holds: Edit is in the bar\'s ⋯, off, and Convert Lead leads', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit(LOCKS_NEW));
    await expectEditInBarOverflowOff();
  });

  it('phone, editLockedByState: Edit is in the bar\'s ⋯, off, Convert Lead leads, and the badge states why', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadLockedByState());
    await waitFor(() => expect(screen.getByTestId('record-state-lock').textContent).toBe('Not editable in its current state'), { timeout: 5000 });
    await expectEditInBarOverflowOff();
  });

  it('control, phone: a disabledWhen that does not hold keeps [Edit][Convert Lead][⋯] with Edit pressable', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit("record.status == 'closed'"));
    await barDrawn();
    await waitFor(() => expect(barButtons()).toEqual(['Edit', 'Convert Lead', 'More actions']));
    const first = actionBar()!.querySelector('[role="toolbar"] button') as HTMLButtonElement;
    expect(first.disabled).toBe(false);
  });

  it('control, desktop: edit.disabledWhen keeps Edit greyed in place in the header row', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit(LOCKS_NEW));
    const edit = await desktopRowEdit();
    await waitFor(() => expect(edit.disabled).toBe(true));
    expect(actionBar()).toBeNull();
  });

  it('control, desktop: editLockedByState keeps Edit greyed in place in the header row', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadLockedByState());
    const edit = await desktopRowEdit();
    await waitFor(() => expect(edit.disabled).toBe(true));
    expect(actionBar()).toBeNull();
  });

  it('control, desktop: the approval lock draws no Edit in the header row (objectstack#35593)', async () => {
    setWidth(1440);
    stubApprovals(PENDING_REQUEST);
    mountApprovalPage();
    const more = await screen.findByTestId('declared-actions-header-menu', undefined, { timeout: 5000 });
    const row = more.closest('[role="toolbar"]') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(actionBar()).toBeNull();
  });
});

/**
 * objectstack#35135 — an Edit or Delete greyed by `userActions.*.disabledWhen`
 * says why, with the generic sentence an authored action without a declared
 * reason gives (`actions.notAvailableForRecord`):
 *
 *  - desktop: the header row's Edit is described by the reason, and its
 *    wrapper opens it as a tooltip; the `⋯`'s Delete shows it as its second
 *    line;
 *  - phone: the bar's `⋯` entry for Edit shows it as its second line.
 *
 * Controls: the approval band and the state-lock badge explain their own
 * locks, so an Edit they turn off gives no second, generic reason; a
 * `disabledWhen` that does not hold gives none.
 */
const PREDICATE_REASON = 'Not available for this record';

function leadWithDisabledDelete(when: string): PageObjects {
  const [lead, ...rest] = objectsWith([action('convert', 'Convert Lead'), action('assign', 'Assign')]);
  return [{ ...lead, userActions: { delete: { disabledWhen: when } } }, ...rest] as never;
}

const describedText = (el: Element) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent ?? null : null;
};

describe('a disabledWhen-greyed Edit or Delete says why (objectstack#35135)', () => {
  beforeEach(() => {
    __resetRecordApprovalsStore();
  });

  it('desktop, edit.disabledWhen holds: Edit is off and described by the generic reason, which its wrapper shows', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit(LOCKS_NEW));
    const edit = await desktopRowEdit();
    await waitFor(() => expect(edit.disabled).toBe(true));
    await waitFor(() => expect(describedText(edit)).toBe(PREDICATE_REASON));
    expect(edit.parentElement!.hasAttribute('data-disabled-reason')).toBe(true);
  });

  it('phone, edit.disabledWhen holds: the bar\'s ⋯ entry for Edit shows the reason', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit(LOCKS_NEW));
    await expectEditInBarOverflowOff();
    const menu = screen.getByRole('menu');
    const edit = within(menu).getByRole('menuitem', { name: 'Edit' });
    expect(describedText(edit)).toBe(PREDICATE_REASON);
  });

  it('desktop, delete.disabledWhen holds: the ⋯\'s Delete is off and shows the reason', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledDelete(LOCKS_NEW));
    const header = await waitFor(() => {
      const el = document.querySelector('[data-record-top-bar-actions]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    }, { timeout: 5000 });
    const more = await waitFor(() => within(within(header).getByRole('toolbar')).getByRole('button', { name: 'More actions' }));
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    const del = within(menu).getByRole('menuitem', { name: 'Delete' });
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(describedText(del)).toBe(PREDICATE_REASON);
  });

  it('control, desktop: a disabledWhen that does not hold leaves Edit on and silent', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], leadWithDisabledEdit("record.status == 'closed'"));
    const edit = await desktopRowEdit();
    expect(edit.disabled).toBe(false);
    expect(edit.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText(PREDICATE_REASON)).toBeNull();
  });

  it('control, desktop: a state-locked Edit whose disabledWhen also holds gives the badge, never the generic reason too', async () => {
    setWidth(1440);
    const [lead, ...rest] = leadLockedByState() as unknown as Array<Record<string, unknown>>;
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], [{ ...lead, userActions: { edit: { disabledWhen: LOCKS_NEW } } }, ...rest] as never);
    await waitFor(() => expect(screen.getByTestId('record-state-lock').textContent).toBe('Not editable in its current state'), { timeout: 5000 });
    const edit = await desktopRowEdit();
    expect(edit.disabled).toBe(true);
    expect(edit.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText(PREDICATE_REASON)).toBeNull();
  });

  it('control, desktop: an approval-locked record whose edit disabledWhen also holds draws no Edit and no generic reason', async () => {
    setWidth(1440);
    stubApprovals(PENDING_REQUEST);
    mountApprovalPage(leadWithDisabledEdit(LOCKS_NEW) as unknown[]);
    const more = await screen.findByTestId('declared-actions-header-menu', undefined, { timeout: 5000 });
    const row = more.closest('[role="toolbar"]') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText(PREDICATE_REASON)).toBeNull();
  });
});

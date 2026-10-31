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
 *    highlights, then at most four highlights;
 *  - Target 7, the bottom bar: the header's actions drawn below the body, in
 *    their bar face — the primary, one more and the `⋯`; with a declared
 *    second action the host's Edit folds into the `⋯`, with one it takes the
 *    second slot; the header draws no action row of its own;
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
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

  it('opened directly: 「‹ Leads」 to the object\'s list, and no counter', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    await barDrawn();
    const back = pageBar()!.querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
    expect(back.textContent).toBe('Leads');
    expect(back.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);
    expect(pageBar()!.querySelector('[data-record-top-bar-position]')).toBeNull();
  });

  it('the header: the subtitle from the first two declared text highlights, then at most four highlights', async () => {
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
    const strip = document.querySelector('[data-highlights-face]') as HTMLElement;
    expect(strip).toBeTruthy();
    const text = strip.textContent ?? '';
    // Email, Status, Phone, City: four, after the subtitle's two; the fifth
    // declared one (Website) is in the sections.
    expect(strip.children).toHaveLength(4);
    expect(text).toContain('mira@atlas.test');
    expect(text).toContain('Austin');
    expect(text).not.toContain('Atlas Construction');
    expect(text).not.toContain('atlas.test/');
    expect(text).not.toContain('https://atlas.test');
  });

  it('the bottom bar: [Convert Lead][Assign][⋯] with the host\'s Edit in the ⋯; the header draws no action row', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    const toolbar = await barDrawn();
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('bar');
    expect(barButtons()).toEqual(['Convert Lead', 'Assign', 'More actions']);
    // The header above the body has no toolbar of its own, and the bar is
    // below the body, not in it.
    const header = document.querySelector('[data-record-page-root] header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(within(header).queryByRole('toolbar')).toBeNull();
    expect(header.contains(actionBar())).toBe(false);
    expect(actionBar()!.contains(header)).toBe(false);
    const items = await moreItems();
    expect(items).toContain('Edit');
  });

  it('the bottom bar with one declared action: [Convert Lead][Edit][⋯]', async () => {
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`], objectsWith([action('convert', 'Convert Lead')]));
    await barDrawn();
    const buttons = barButtons();
    expect(buttons.slice(0, 2)).toEqual(['Convert Lead', 'Edit']);
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

  it('control: at 1440 px the desktop bar (⊟) and the header\'s own action row, no bottom bar', async () => {
    setWidth(1440);
    mountPage([`/apps/${APP}/${LEAD}/record/r-1`]);
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(actionBar()).toBeNull();
    const header = document.querySelector('[data-record-page-root] header') as HTMLElement;
    const toolbar = await waitFor(() => {
      const el = within(header).getByRole('toolbar');
      return el;
    });
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('row');
    expect(within(toolbar).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(document.querySelector('[data-page-header-subtitle="host"]')).toBeNull();
    expect(screen.getByTestId('record-page-crumb')).toBeTruthy();
  });
});

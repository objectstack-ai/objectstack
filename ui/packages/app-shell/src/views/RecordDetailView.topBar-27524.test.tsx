/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 7 — the record's top bar on each face, from a real
 * `RecordDetailView` mount (the `panelToggles-27052` harness).
 *
 *  - the page opened directly: the breadcrumb 「对象 › 记录名」 (the object goes
 *    to the object's list), ⊟ where the tier has a right column, nothing else
 *    — no counter, no ↓ ↑, no ⤡; the crumb row is gone;
 *  - the page the list row's ↗ opened: the counter (its tooltip naming the
 *    list's view), ↓ ↑ and `j` / `k` over the list's rows — a step replaces the
 *    page with the sibling's — ⤡ 「Collapse to drawer」 back to the list with
 *    the record stepped to open, and the object crumb back to the list;
 *  - the page under a `?from=` trail: ← and the path, each ancestor a link;
 *  - the record in a pane: the pane's bar names it at the root, and its ⊟ sits
 *    in that bar, not in the header's action row.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
import { RecordStackDrawer, recordDrawerReturnState, useRecordDrawerStack } from './recordDrawerStack';

const APP = 'demo';
const LEAD = 'crm_lead';
const BASE_FIELDS = { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } };
const OBJECTS = [
  { name: LEAD, label: 'Lead', pluralLabel: 'Leads', fields: BASE_FIELDS },
  { name: 'crm_task', label: 'Task', pluralLabel: 'Tasks', fields: { ...BASE_FIELDS, lead: { type: 'lookup', reference: LEAD, label: 'Lead' } } },
];
const ROWS = ['r-1', 'r-2', 'r-3'];

let rootWidth = 1440;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Record ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

const metadata = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as never;

function Where() {
  const location = useLocation();
  return (
    <>
      <output data-testid="where">{`${location.pathname}${location.search}`}</output>
      <output data-testid="where-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function mountPage(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const dataSource = makeDataSource();
  render(
    <MemoryRouter initialEntries={[entry as never]}>
      <MetadataCtx.Provider value={metadata}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={dataSource as never} objects={OBJECTS} onEdit={() => {}} />}
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

beforeEach(() => {
  cleanup();
  rootWidth = 1440;
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
});

describe('the page\'s top bar (objectstack#27524, Target 7)', () => {
  it('opened directly: 「对象 › 记录名」 and ⊟, nothing else; the crumb row is gone', async () => {
    mountPage(`/apps/${APP}/${LEAD}/record/r-1`);
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const bar = pageBar()!;
    expect(bar).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('record-page-crumb').textContent).toBe('LeadsRecord r-1'));
    const object = bar.querySelector('[data-record-crumb-object]') as HTMLAnchorElement;
    expect(object.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);
    expect(bar.querySelector('[data-record-top-bar-step]')).toBeNull();
    expect(bar.querySelector('[data-record-top-bar-position]')).toBeNull();
    expect(screen.queryByTestId('record-drawer-return')).toBeNull();
    expect(bar.querySelector('[role="group"][aria-label="Panels"]')).not.toBeNull();
    expect(document.querySelector('[data-record-crumb-row]')).toBeNull();
  });

  it('opened from the list row\'s ↗: the counter, ↓ ↑ and j / k over the list\'s rows, ⤡ and the object crumb back to the list', async () => {
    const back = recordDrawerReturnState(
      { pathname: `/apps/${APP}/${LEAD}`, search: '?recordId=r-2', state: null },
      [{ objectName: LEAD, recordId: 'r-2', siblings: ROWS }],
    );
    mountPage({
      pathname: `/apps/${APP}/${LEAD}/record/r-2`,
      state: { ...back, from: { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads' } },
    });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const position = () => pageBar()!.querySelector('[data-record-top-bar-position]');
    expect(position()?.textContent).toBe('2 / 3');
    expect(position()?.getAttribute('title')).toBe('2 of 3 in All leads');
    // ⊟ after the step group, ⤡ at the end.
    const controls = Array.from(pageBar()!.querySelector('[data-record-top-bar-controls]')!.children);
    expect(controls.at(-1)?.getAttribute('data-testid')).toBe('record-drawer-return');

    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-3`));
    await waitFor(() => expect(position()?.textContent).toBe('3 / 3'));
    expect((screen.getByRole('button', { name: 'Next record' }) as HTMLButtonElement).disabled).toBe(true);
    // `k` steps back; the arrow keys are the page's scroll, not the bar's.
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-3`);
    fireEvent.keyDown(document.body, { key: 'k' });
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));

    // ⤡ returns to the list with the record stepped to open in its pane.
    fireEvent.click(screen.getByTestId('record-drawer-return'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}?recordId=r-2`));
    expect(screen.getByTestId('where-state').textContent).toContain('"recordDrawerRestore":[{"objectName":"crm_lead","recordId":"r-2"');
  });

  it('opened by a list whose rows open as pages: the counter and ↓ ↑ over its rows, and no ⤡', async () => {
    const from = { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS };
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from } });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const position = () => pageBar()!.querySelector('[data-record-top-bar-position]');
    expect(position()?.textContent).toBe('1 / 3');
    expect(position()?.getAttribute('title')).toBe('1 of 3 in All leads');
    // That list opens no pane: there is nothing to collapse to.
    expect(screen.queryByTestId('record-drawer-return')).toBeNull();
    // The object crumb is the list it came from.
    expect(pageBar()!.querySelector('[data-record-crumb-object]')?.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);

    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));
    await waitFor(() => expect(position()?.textContent).toBe('2 / 3'));
    // The next page keeps the same list.
    expect(JSON.parse(screen.getByTestId('where-state').textContent!)).toEqual({ from });
    fireEvent.click(screen.getByRole('button', { name: 'Previous record' }));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-1`));
  });

  it('control: a list\'s origin without its rows draws no counter', async () => {
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from: { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads' } } });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(pageBar()!.querySelector('[data-record-top-bar-position]')).toBeNull();
    expect(pageBar()!.querySelector('[data-record-top-bar-step]')).toBeNull();
  });

  it('the object crumb of a ↗ page returns to the list with no record open', async () => {
    const back = recordDrawerReturnState(
      { pathname: `/apps/${APP}/${LEAD}`, search: '?view=all&recordId=r-1', state: null },
      [{ objectName: LEAD, recordId: 'r-1', siblings: ROWS }],
    );
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { ...back, from: { pathname: `/apps/${APP}/${LEAD}?view=all`, label: 'All leads' } } });
    const object = await waitFor(() => {
      const el = pageBar()?.querySelector('[data-record-crumb-object]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(object.textContent).toBe('Leads');
    fireEvent.click(object);
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}?view=all`));
  });

  it('under a ?from= trail: ← and the path, each ancestor a link to its page', async () => {
    const trail = encodeURIComponent(JSON.stringify([{ o: LEAD, i: 'L-1', t: 'Mira Costa' }]));
    mountPage(`/apps/${APP}/crm_task/record/t-1?from=${trail}`);
    const path = await screen.findByTestId('record-page-trail', undefined, { timeout: 5000 });
    expect(path.textContent).toBe('Lead Mira CostaTask');
    const ancestor = path.querySelector('a')!;
    expect(ancestor.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}/record/L-1`);
    const backLink = pageBar()!.querySelector('[data-record-crumb-back]')!;
    expect(backLink.getAttribute('aria-label')).toBe('Go back');
    expect(screen.queryByTestId('record-page-crumb')).toBeNull();
  });
});

/** The list host's pane, drawing the record embedded (`objectViewRecordOverlay.tsx`'s shape). */
function PaneHost({ dataSource }: { dataSource: unknown }) {
  const [recordId, setRecordId] = React.useState('r-1');
  const root = React.useMemo(() => ({ objectName: LEAD, recordId, siblings: ROWS }), [recordId]);
  const stack = useRecordDrawerStack({ root, onRootStep: setRecordId });
  return (
    <RecordStackDrawer
      stack={stack}
      open
      mode="split"
      mainContent={<div data-testid="list" />}
      objects={OBJECTS}
      stepScope="All leads"
      onClose={() => {}}
      renderRecord={(level) => (
        <RecordDetailView
          dataSource={dataSource as never}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={level.objectName}
          recordIdOverride={level.recordId}
          embedded
        />
      )}
    />
  );
}

describe('the pane\'s top bar holds the record\'s ⊟ and names it (objectstack#27524)', () => {
  it('the record reports its title to the breadcrumb, and its ⊟ sits in the pane\'s bar, not the header', async () => {
    const dataSource = makeDataSource();
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}?recordId=r-1`]}>
        <MetadataCtx.Provider value={metadata}>
          <PaneHost dataSource={dataSource} />
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('record-drawer-crumb').textContent).toBe('LeadsRecord r-1'), { timeout: 5000 });
    const group = await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(group.closest('[data-record-pane-toggles]')).not.toBeNull();
    expect(group.closest('[data-record-top-bar]')).not.toBeNull();
    expect(group.closest('[data-record-page-root]')).toBeNull();
    expect(document.querySelector('[data-page-header-trailing]')).toBeNull();
    // The pane draws its own bar; the record inside draws none.
    expect(document.querySelectorAll('[data-record-top-bar]')).toHaveLength(1);
    expect(document.querySelector('[data-record-top-bar-position]')?.getAttribute('title')).toBe('1 of 3 in All leads');

    // A step names the next record once it reports its title.
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    await waitFor(() => expect(screen.getByTestId('record-drawer-crumb').textContent).toBe('LeadsRecord r-2'), { timeout: 5000 });
  });
});

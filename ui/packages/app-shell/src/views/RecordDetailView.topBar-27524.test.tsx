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
 * Two rows on a desktop since objectstack#35853 (figure 40): the navigation
 * row over the record row.
 *
 *  - the page opened directly: the navigation row names the object (a link to
 *    the object's list) and ends in ✕, which goes there too; no counter, no
 *    ↑ ↓; the record row holds the header's name and ⊟;
 *  - the page the list's record name opened (objectstack#35854): ↑ ↓ and
 *    「N of M · view」 over the list's matched total — a step replaces the page
 *    with the sibling's, `j` / `k` step too — and ✕ or the view's name back to
 *    the list as it was left; no ⤡ (the 「Collapse to drawer」 hop retired);
 *  - the page under a `?from=` trail: ← and the path, each ancestor a link;
 *  - the record in a pane: the pane's bar names it at the root, and its ⊟ sits
 *    in that bar, not in the header's action row.
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
import { RecordStackDrawer, useRecordDrawerStack } from './recordDrawerStack';
import { ShellPageActionsScope } from '../layout/ShellPageActions';

const APP = 'demo';
const LEAD = 'crm_lead';
const BASE_FIELDS = { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } };
const OBJECTS = [
  // objectstack#35985 — a coloured object, so the record row's tile is pinned below.
  { name: LEAD, label: 'Lead', pluralLabel: 'Leads', icon: 'user', color: 'orange', fields: BASE_FIELDS },
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

function mountPage(
  entry: string | { pathname: string; search?: string; state?: unknown },
  dataSource: ReturnType<typeof makeDataSource> = makeDataSource(),
) {
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

describe('the page\'s top bar (objectstack#27524, Target 7; two rows since objectstack#35853)', () => {
  it('opened directly: the navigation row names the object, ✕ at its right; the record row holds the name and ⊟', async () => {
    mountPage(`/apps/${APP}/${LEAD}/record/r-1`);
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const bar = pageBar()!;
    expect(bar).not.toBeNull();
    // objectstack#35853 — two rows: navigation over the record.
    const nav = bar.querySelector('[data-record-top-bar-nav]') as HTMLElement;
    const record = bar.querySelector('[data-record-top-bar-record]') as HTMLElement;
    await waitFor(() => expect(record.querySelector('[data-record-bar-title] h1')?.textContent).toBe('Record r-1'));
    expect(nav.querySelector('[data-record-bar-title]')).toBeNull();
    // No list: the object's name, a link to the object's list, and no ↑ ↓.
    expect(within(nav).getByTestId('record-page-crumb').textContent).toBe('Leads');
    const object = nav.querySelector('[data-record-crumb-object]') as HTMLAnchorElement;
    expect(object.getAttribute('href')).toBe(`/apps/${APP}/${LEAD}`);
    expect(bar.querySelector('[data-record-top-bar-step]')).toBeNull();
    expect(bar.querySelector('[data-record-top-bar-position]')).toBeNull();
    expect(bar.querySelector('[data-record-bar-separator]')).toBeNull();
    // ✕ is the navigation row's last control, and goes to the object's list.
    const frame = nav.querySelector('[data-record-top-bar-frame]') as HTMLElement;
    expect(frame.lastElementChild?.getAttribute('data-testid')).toBe('record-page-close');
    expect(record.querySelector('[role="group"][aria-label="Panels"]')).not.toBeNull();
    expect(document.querySelector('[data-record-crumb-row]')).toBeNull();
    fireEvent.click(screen.getByTestId('record-page-close'));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}`));
  });

  it('opened by the list\'s record name: 「N of M · view」 over the list\'s matched total, ↑ ↓ and j / k over its rows', async () => {
    const from = { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS, total: 40 };
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-2`, state: { from } });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const nav = () => pageBar()!.querySelector('[data-record-top-bar-nav]') as HTMLElement;
    const position = () => nav().querySelector('[data-record-top-bar-position]');
    expect(position()?.textContent).toBe('2 of 40');
    expect(position()?.getAttribute('title')).toBe('2 of 40 in All leads');
    expect(nav().querySelector('[data-record-top-bar-scope]')?.textContent).toBe('All leads');
    // The figure's order: ↑ then ↓, then the count; no object crumb beside them.
    const steps = Array.from(nav().querySelectorAll('[data-record-top-bar-step]')).map((el) => el.getAttribute('data-record-top-bar-step'));
    expect(steps).toEqual(['previous', 'next']);
    expect(nav().querySelector('[data-record-crumb-object]')).toBeNull();
    expect(screen.queryByTestId('record-drawer-return')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-3`));
    await waitFor(() => expect(position()?.textContent).toBe('3 of 40'));
    // The end of the rows the list loaded: ↓ stops there, even short of the total.
    expect((screen.getByRole('button', { name: 'Next record' }) as HTMLButtonElement).disabled).toBe(true);
    // `k` steps back; the arrow keys are the page's scroll, not the bar's.
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-3`);
    fireEvent.keyDown(document.body, { key: 'k' });
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));
  });

  it('control: with no total reported the counter counts the rows handed along; the first has no ↑', async () => {
    const from = { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS };
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from } });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const position = () => pageBar()!.querySelector('[data-record-top-bar-position]');
    expect(position()?.textContent).toBe('1 of 3');
    expect(position()?.getAttribute('title')).toBe('1 of 3 in All leads');
    expect((screen.getByRole('button', { name: 'Previous record' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));
    await waitFor(() => expect(position()?.textContent).toBe('2 of 3'));
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

  it.each([['✕', 'record-page-close'], ['the view\'s name', 'scope']])(
    '%s returns to the list the page came from, as it was left, with no record open',
    async (_name, control) => {
      mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from: { pathname: `/apps/${APP}/${LEAD}?view=all`, label: 'All leads', siblings: ROWS } } });
      await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
      const target = control === 'scope'
        ? pageBar()!.querySelector('[data-record-top-bar-scope]') as HTMLElement
        : screen.getByTestId('record-page-close');
      fireEvent.click(target);
      await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}?view=all`));
    },
  );

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

/** A read the test answers when it chooses: `findOne` for `held` waits on it. */
function deferredRead(held: string) {
  let answer: (row: unknown) => void = () => {};
  const pending = new Promise((resolve) => { answer = resolve; });
  const dataSource = makeDataSource();
  dataSource.findOne = vi.fn(async (_o: string, recordId: string) =>
    recordId === held ? pending : { id: recordId, name: `Record ${recordId}` }) as never;
  return { dataSource, answer: () => answer({ id: held, name: `Record ${held}` }) };
}

describe('the breadcrumb while the record is read (objectstack#35412)', () => {
  // The record's name in the bar: the header's H1 once the header holds the
  // bar (objectstack#35593), the crumb's own name until then.
  const crumbName = () =>
    document.querySelector('[data-record-bar-title]:not([hidden]) h1')?.textContent
    ?? document.querySelector('[data-record-page-title]')?.textContent;

  it('names the record by its object until the read lands, never by its id', async () => {
    const read = deferredRead('r-1');
    mountPage(`/apps/${APP}/${LEAD}/record/r-1`, read.dataSource);
    await waitFor(() => expect(read.dataSource.findOne).toHaveBeenCalled(), { timeout: 5000 });
    expect(crumbName()).toBe('Lead');
    expect(crumbName()).not.toContain('#');
    read.answer();
    await waitFor(() => expect(crumbName()).toBe('Record r-1'));
  });

  it('a step to the next record names it by its object while it is read, not by the record left', async () => {
    const read = deferredRead('r-2');
    const from = { pathname: `/apps/${APP}/${LEAD}`, label: 'All leads', siblings: ROWS };
    mountPage({ pathname: `/apps/${APP}/${LEAD}/record/r-1`, state: { from } }, read.dataSource);
    await waitFor(() => expect(crumbName()).toBe('Record r-1'), { timeout: 5000 });
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(where()).toBe(`/apps/${APP}/${LEAD}/record/r-2`));
    await waitFor(() => expect(read.dataSource.findOne.mock.calls.some((call) => call[1] === 'r-2')).toBe(true));
    expect(crumbName()).toBe('Lead');
    read.answer();
    await waitFor(() => expect(crumbName()).toBe('Record r-2'));
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
      mode="drawer"
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

describe('the pane\'s top bar names the record (objectstack#27524)', () => {
  it('the record\'s header names it in the pane\'s bar; a pane draws no right rail, so no ⊟ (objectstack#35596)', async () => {
    const dataSource = makeDataSource();
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}?recordId=r-1`]}>
        <MetadataCtx.Provider value={metadata}>
          <PaneHost dataSource={dataSource} />
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    // objectstack#35593 — the record's header holds the pane's bar: its H1 is
    // the bar's name. objectstack#35853 — the pane's navigation row draws ↑ ↓
    // and 「N of M · view」 over the list beside it.
    const paneTitle = () => document.querySelector('[data-record-bar-title] h1')?.textContent;
    await waitFor(() => expect(paneTitle()).toBe('Record r-1'), { timeout: 5000 });
    expect(screen.queryByTestId('record-drawer-crumb')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-record-page-tier]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
    expect(document.querySelector('[data-record-column="right"]')).toBeNull();
    expect(document.querySelector('[data-page-header-trailing]')).toBeNull();
    // The pane draws its own bar; the record inside draws none.
    expect(document.querySelectorAll('[data-record-top-bar]')).toHaveLength(1);
    expect(document.querySelector('[data-record-top-bar-position]')?.textContent).toBe('1 of 3');
    expect(document.querySelector('[data-record-top-bar-scope]')?.textContent).toBe('All leads');
    expect(screen.getByRole('button', { name: 'Next record' })).toBeTruthy();

    // The step keys stay: j names the next record once its header draws.
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(paneTitle()).toBe('Record r-2'), { timeout: 5000 });
  });
});

describe('the record row leads with the object\'s colour tile (objectstack#35985)', () => {
  it('on the page: the tile in the object\'s colour, before the record\'s name', async () => {
    mountPage(`/apps/${APP}/${LEAD}/record/r-1`);
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const record = pageBar()!.querySelector('[data-record-top-bar-record]') as HTMLElement;
    const tiles = record.querySelectorAll('[data-object-icon-tile]');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].getAttribute('data-object-icon-tile')).toBe('orange');
  });

  it('in a pane: the pane\'s record row draws the same tile', async () => {
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}?recordId=r-1`]}>
        <MetadataCtx.Provider value={metadata}>
          <PaneHost dataSource={makeDataSource()} />
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('[data-record-bar-title] h1')?.textContent).toBe('Record r-1'), { timeout: 5000 });
    const tiles = document.querySelectorAll('[data-record-top-bar] [data-object-icon-tile]');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].getAttribute('data-object-icon-tile')).toBe('orange');
  });
});

describe('the shell\'s top-right button group on the record page (objectstack#36111)', () => {
  function mountUnderShell(on: boolean | undefined) {
    const dataSource = makeDataSource();
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}/record/r-1`]}>
        <MetadataCtx.Provider value={metadata}>
          <ShellPageActionsScope on={on}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={<RecordDetailView dataSource={dataSource as never} objects={OBJECTS} onEdit={() => {}} />}
              />
            </Routes>
          </ShellPageActionsScope>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
  }

  it('turned on: the group sits in the navigation row, before ✕, which stays last', async () => {
    mountUnderShell(true);
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    const nav = pageBar()!.querySelector('[data-record-top-bar-nav]') as HTMLElement;
    const frame = nav.querySelector('[data-record-top-bar-frame]') as HTMLElement;
    const group = within(frame).getByTestId('shell-page-actions');
    expect(frame.lastElementChild?.getAttribute('data-testid')).toBe('record-page-close');
    expect(group.nextElementSibling?.getAttribute('data-testid')).toBe('record-page-close');
    // Help is always in it; the record row carries none of it.
    expect(within(group).getByTestId('shell-page-actions-help')).toBeTruthy();
    const record = pageBar()!.querySelector('[data-record-top-bar-record]') as HTMLElement;
    expect(within(record).queryByTestId('shell-page-actions')).toBeNull();
  });

  it('while the top bar stands (the default, and with no shell above): no group, ✕ alone', async () => {
    for (const on of [undefined, false] as const) {
      mountUnderShell(on);
      await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
      const frame = pageBar()!.querySelector('[data-record-top-bar-frame]') as HTMLElement;
      expect(within(frame).queryByTestId('shell-page-actions')).toBeNull();
      expect(frame.children).toHaveLength(1);
      cleanup();
    }
  });
});

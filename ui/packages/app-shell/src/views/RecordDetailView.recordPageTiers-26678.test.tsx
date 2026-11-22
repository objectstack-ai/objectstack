/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 / objectstack#27524 (Target 6) — the synthesized record
 * page is one page, laid out by one rule: the width of the container it
 * occupies.
 *
 * Measured from a real `RecordDetailView` mount (the `relatedListTitlePlural`
 * harness). The page takes its tier from the width of this view's root and
 * never from the viewport, so the root's measured width is the one input
 * varied here: every other element measures as the test environment measures
 * it.
 *
 *  - objectstack#35890 (ruling 7064066204): a full page whose content fits
 *    320 + 24 + 400 px pins the details in a left column (400 px, narrowing
 *    to 320) and draws the other tabs beside them, opening on the first.
 *    No page draws the retired right rail (objectstack#35596) at any width.
 *  - Narrower (the split pane at 720, a phone at 390): ONE column, the
 *    details as the first tab, 「详情」, of the record's tab row (Target 8).
 *    On a phone (objectstack#27058: a 390 px window, not only a 390 px root)
 *    the header's actions sit in the bottom bar after it, and its `⋯` at the
 *    top bar's right end (objectstack#36151).
 *  - The embedded record (drawer / split pane) never pins.
 *  - History is read at open in every tier. `?tab=` addresses no strip;
 *    `?related=timeline` is the 动态 tab, the full stream.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

// Orthogonal chrome — stubbed so the only asynchrony here is the page's own.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const PARENT = 'showcase_project';
const RECORD_ID = 'p-1';

const BASE_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

/**
 * The project's own text fields, each with a value: more than the header's
 * highlights take, so the details section holds enough of them (more than
 * five) for the wide tier's three-column grid.
 */
const PROJECT_TEXT = ['code', 'region', 'sponsor', 'phase', 'cost_center', 'tier', 'site', 'channel', 'segment', 'program', 'quarter', 'team'];

const OBJECTS = [
  {
    name: PARENT,
    label: 'Project',
    pluralLabel: 'Projects',
    managedBy: 'platform',
    // History is on for this object, so the synthesized page carries it.
    enable: { trackHistory: true },
    // A worked object — its status options declare lifecycle kinds. Since
    // objectstack#27524 that no longer changes the page: every object's page
    // has the same two columns.
    fields: {
      ...BASE_FIELDS,
      ...Object.fromEntries(PROJECT_TEXT.map((name) => [name, { type: 'text', label: name }])),
      status: {
        type: 'select',
        label: 'Status',
        options: [
          { value: 'active', label: 'Active', kind: 'open' },
          { value: 'done', label: 'Done', kind: 'won' },
        ],
      },
    },
  },
  {
    name: 'showcase_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    managedBy: 'platform',
    // `relatedList: true`: a side list with a tab (objectstack#35597 makes a plain master_detail FK an overview body table).
    fields: { ...BASE_FIELDS, project: { type: 'master_detail', reference: PARENT, label: 'Project', relatedList: true } },
  },
  {
    name: 'showcase_note',
    label: 'Note',
    pluralLabel: 'Notes',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, project: { type: 'lookup', reference: PARENT, label: 'Project' } },
  },
  { name: 'sys_audit_log', label: 'Audit log', managedBy: 'platform', fields: BASE_FIELDS },
];

/** The width this view's root measures; every other element measures as the environment does. */
let rootWidth = 0;
let dataSource: { find: ReturnType<typeof vi.fn> } & Record<string, unknown>;

/**
 * The related lists' totals: both have records, so their tabs sit on the tab
 * row, which keeps empty lists' tabs in its dropdown (objectstack#28469).
 */
const RELATED_TOTALS: Record<string, number> = { showcase_task: 2, showcase_note: 1 };

/**
 * A rejected read in the shape the ObjectStack client throws it: the HTTP
 * status on `httpStatus` and the ADR-0112 code on `code`.
 */
const rejection = (httpStatus: number, code: string) =>
  Object.assign(new Error(`${httpStatus} ${code}`), { httpStatus, code });

function makeDataSource(auditRead?: () => Promise<unknown>) {
  return {
    find: vi.fn(async (objectName: string) =>
      objectName === 'sys_audit_log' && auditRead ? auditRead() : { data: [], total: RELATED_TOTALS[objectName] ?? 0 },
    ),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({
      id: recordId,
      name: `Project ${recordId}`,
      ...Object.fromEntries(PROJECT_TEXT.map((name) => [name, `${name} value`])),
      status: 'active',
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

function renderPage({
  width,
  embedded = false,
  search = '',
  windowWidth = 1440,
  objects = OBJECTS,
  auditRead,
}: {
  width: number;
  embedded?: boolean;
  search?: string;
  windowWidth?: number;
  objects?: typeof OBJECTS;
  /** How this reader's `sys_audit_log` read answers; omitted, it answers no rows. */
  auditRead?: () => Promise<unknown>;
}) {
  rootWidth = width;
  Object.defineProperty(window, 'innerWidth', { value: windowWidth, configurable: true, writable: true });
  dataSource = makeDataSource(auditRead);
  const metadata = {
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
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}${search}`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource as never}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={PARENT}
          recordIdOverride={RECORD_ID}
          embedded={embedded}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const tierOf = (container: HTMLElement) =>
  container.querySelector('[data-record-page-tier]')?.getAttribute('data-record-page-tier') ?? null;
const column = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-record-column="${name}"]`) as HTMLElement | null;
const auditReads = () => dataSource.find.mock.calls.filter((call) => call[0] === 'sys_audit_log').length;

beforeEach(() => {
  cleanup();
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: rootWidth, bottom: 800, width: rootWidth, height: 800, toJSON: () => ({}) } as DOMRect;
  });
  // objectstack#35890 — pinning reads the page content's own width
  // (`clientWidth`): every element measures the root's width here.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => rootWidth);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
});

const shown = (container: HTMLElement) =>
  container.querySelector('[data-record-columns-shown]')?.getAttribute('data-record-columns-shown') ?? null;
const columnsStyle = (container: HTMLElement) =>
  (container.querySelector('[data-record-columns]') as HTMLElement | null)?.style.gridTemplateColumns ?? '';
/** The details' field grid, by the classes it draws (container queries). */
const detailsGrid = (container: HTMLElement) =>
  column(container, 'details')?.querySelector('[data-detail-section-face="frameless"] .grid')?.getAttribute('class') ?? '';
/** objectstack#35890 — no page draws the retired right rail (its summary cards), at any width. */
const expectNoRail = (container: HTMLElement) => {
  expect(column(container, 'right')).toBeNull();
  expect(container.querySelector('[data-record-summary-card]')).toBeNull();
};

/**
 * The page's only tablist is its tab row (objectstack#27524, Target 8), the
 * active one as `active`. Pinned (objectstack#35890) the details are the left
 * column, so the row starts at the first related list and has no 「详情」.
 */
const expectTabRowOnly = async (active = 'overview', { pinned = false }: { pinned?: boolean } = {}) => {
  // The panels' tabs join the row once their counts land (objectstack#28469).
  await waitFor(() => expect(document.querySelector('[role="tab"][data-record-tab="showcase_note.project"]')).not.toBeNull());
  const lists = screen.getAllByRole('tablist');
  expect(lists).toHaveLength(1);
  expect(lists[0].closest('[data-record-tab-row]')).not.toBeNull();
  const tabs = Array.from(lists[0].querySelectorAll('[role="tab"]'));
  // objectstack#34590, ruling 6937542160 — 动态 last (supersedes objectstack#27524 Targets 5 and 8's 动态-first).
  expect(tabs.map((tab) => tab.getAttribute('data-record-tab'))).toEqual([
    ...(pinned ? [] : ['overview']),
    'showcase_task.project',
    'showcase_note.project',
    'timeline',
  ]);
  expect(lists[0].querySelector('[aria-selected="true"]')?.getAttribute('data-record-tab')).toBe(active);
};

describe('RecordDetailView — one record page, laid out by its width (objectstack#26678, objectstack#27524, objectstack#35890)', () => {
  it('1440 px: the details pinned left at 400 px, one field column; the tabs beside them open on the first list; no rail; History is read at open', async () => {
    const { container } = renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('wide');
    await waitFor(() => expect(shown(container)).toBe('details tabs'));
    expect(columnsStyle(container)).toBe('400px 24px minmax(0,1fr)');
    expect(detailsGrid(container)).toContain('grid-cols-1');
    expect(detailsGrid(container)).not.toContain('@xl:grid-cols-2');
    await expectTabRowOnly('showcase_task.project', { pinned: true });
    // The tabs column holds the first list's face; nothing is written to the address.
    const tabs = column(container, 'tabs')!;
    expect(tabs.querySelector('[data-related-enlarged="showcase_task.project"]')).not.toBeNull();
    expectNoRail(container);
    expect(column(container, 'timeline')).toBeNull();
    // The header is drawn once.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
  });

  it('1100 px and 800 px pin too (ruling 7064066204: fits 320 + 400), the left column narrowing to leave the tabs 400 px', async () => {
    const at1100 = renderPage({ width: 1100 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(at1100.container)).toBe('two-column');
    await waitFor(() => expect(shown(at1100.container)).toBe('details tabs'));
    expect(columnsStyle(at1100.container)).toBe('400px 24px minmax(0,1fr)');
    at1100.unmount();

    const { container } = renderPage({ width: 800 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    await waitFor(() => expect(shown(container)).toBe('details tabs'));
    expect(columnsStyle(container)).toBe('376px 24px minmax(0,1fr)');
    expectNoRail(container);
    await expectTabRowOnly('showcase_task.project', { pinned: true });
  });

  it('the dragged width is the reader\'s, per object: kept in the workspace preference and read again on the next open', async () => {
    window.localStorage.clear();
    const first = renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    await waitFor(() => expect(shown(first.container)).toBe('details tabs'));
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-valuenow')).toBe('400');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    await waitFor(() => expect(columnsStyle(first.container)).toBe('416px 24px minmax(0,1fr)'));
    expect(JSON.parse(window.localStorage.getItem(`os:pref:record.columns.details-width@object:${PARENT}`) ?? 'null')).toEqual({
      width: 416,
      v: 1,
    });
    first.unmount();

    const again = renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    await waitFor(() => expect(columnsStyle(again.container)).toBe('416px 24px minmax(0,1fr)'));
    window.localStorage.clear();
  });

  it.each([
    ['the split pane', 720, 1440],
    ['a phone', 390, 390],
  ])('%s (%i px): one column — the details as the first tab, 「详情」; no rail; History is read at open', async (name, width, windowWidth) => {
    const { container } = renderPage({ width, windowWidth });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('stack');
    expect(shown(container)).toBe('details');
    expect(container.querySelector('[data-record-page-pinned]')).toBeNull();
    await expectTabRowOnly();
    expect(screen.getByRole('tab', { name: /^Details/ }).getAttribute('data-record-tab')).toBe('overview');
    expectNoRail(container);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
    // objectstack#27058 — on a phone the stack ends where the bottom action
    // bar starts: the header's actions are drawn there, after the body, and
    // the header draws no action row. This object declares no action, so the
    // bar is left empty (not drawn) and the header's `⋯` is at the top bar's
    // right end (objectstack#36151). The split pane keeps the header's
    // group, in the page's one top row (objectstack#35593).
    const bar = container.querySelector('[data-record-action-bar]');
    const header = container.querySelector('[data-record-page-root] header') as HTMLElement;
    if (name === 'a phone') {
      await waitFor(() => expect(container.querySelector('[data-record-phone-more] button[aria-label="More actions"]')).toBeTruthy());
      const details = column(container, 'details')!;
      expect(details.compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(bar!.childElementCount).toBe(0);
      expect(header.querySelector('[role="toolbar"]')).toBeNull();
    } else {
      expect(bar).toBeNull();
      await waitFor(() => expect(container.querySelector('[data-record-top-bar-actions] [role="toolbar"]')).toBeTruthy());
    }
  });

  it('embedded (drawer / split pane): never pinned, whatever its width, and no rail', async () => {
    const wide = renderPage({ width: 1440, embedded: true });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(wide.container)).toBe('wide');
    expect(shown(wide.container)).toBe('details');
    expect(wide.container.querySelector('[data-record-page-pinned]')).toBeNull();
    expectNoRail(wide.container);
    await expectTabRowOnly();
    wide.unmount();

    const { container } = renderPage({ width: 720, embedded: true });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('stack');
    await expectTabRowOnly();
  });

  it('`?tab=` addresses no strip on a laid-out page; `?related=timeline` is the 动态 tab: the full stream', async () => {
    const tabbed = renderPage({ width: 720, search: '?tab=related' });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(tabbed.container)).toBe('stack');
    await expectTabRowOnly();
    expect(column(tabbed.container, 'details')).not.toBeNull();
    tabbed.unmount();

    // Not pinned (720 px): the face takes the page, no columns under it.
    const stacked = renderPage({ width: 720, search: '?related=timeline' });
    await waitFor(() => expect(stacked.container.querySelector('[data-related-enlarged="timeline"]')).not.toBeNull(), {
      timeout: 5000,
    });
    expect(stacked.container.querySelector('[data-record-columns]')).toBeNull();
    stacked.unmount();

    // Pinned (1440 px): the 动态 face is the tabs column, beside the details.
    const { container } = renderPage({ width: 1440, search: '?related=timeline' });
    const face = await waitFor(
      () => {
        const el = container.querySelector('[data-related-enlarged="timeline"]');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(face.getAttribute('aria-label')).toBe('Activity');
    // objectstack#36075 — the comment panel holds the comments, so the stream
    // holds the system entries alone: of its chips only 变更 stays.
    expect(face.querySelector('[data-stream-filters]')).not.toBeNull();
    expect(face.querySelector('[data-record-timeline-peek]')).toBeNull();
    expect(face.closest('[data-record-column="tabs"]')).not.toBeNull();
    expect(column(container, 'details')).not.toBeNull();
    await expectTabRowOnly('timeline', { pinned: true });
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
  });
});

/**
 * objectstack#30074 offers the 动态 tab's 变更 chip only while the record shows
 * its field history. Since objectstack#36075 the comment panel holds the
 * comments on the desktop, so 全部 / 活动 / 讨论 go and 变更 alone stays, on
 * the same rule; pressed again it goes back to every entry.
 */
describe('RecordDetailView — the 动态 tab offers 变更 only while the record shows its field history (objectstack#30074, objectstack#36075)', () => {
  /** The full stream's chips, in order, once the 动态 tab has drawn. */
  const streamChips = async (container: HTMLElement) => {
    await waitFor(() => expect(container.querySelector('[data-related-enlarged="timeline"]')).not.toBeNull(), {
      timeout: 5000,
    });
    return Array.from(container.querySelectorAll('[data-related-enlarged="timeline"] [data-stream-filter]')).map((chip) =>
      chip.getAttribute('data-stream-filter'),
    );
  };

  /** The chips once this reader's audit read has gone out and settled. */
  const streamChipsAfterAuditRead = async (container: HTMLElement) => {
    await streamChips(container);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0), { timeout: 5000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return streamChips(container);
  };

  it('an object with `enable.trackHistory`, its audit read answered: 变更 alone, a toggle', async () => {
    const { container } = renderPage({ width: 1440, search: '?related=timeline' });
    await waitFor(async () => expect(await streamChipsAfterAuditRead(container)).toEqual(['changes']), { timeout: 5000 });
    const chip = container.querySelector('[data-related-enlarged="timeline"] [data-stream-filter="changes"]') as HTMLElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('the same object without it: no chip, and no audit read', async () => {
    const untracked = OBJECTS.map((o) => (o.name === PARENT ? { ...o, enable: undefined } : o)) as typeof OBJECTS;
    const { container } = renderPage({ width: 1440, search: '?related=timeline', objects: untracked });
    expect(await streamChips(container)).toEqual([]);
    expect(auditReads()).toBe(0);
  });

  // objectstack#30344 — a reader the server refuses the audit read to has
  // nothing for 变更 to hold, so the chip is not offered, as with history off.
  it('a reader whose audit read is refused (403): no chip, as with history off', async () => {
    const { container } = renderPage({
      width: 1440,
      search: '?related=timeline',
      auditRead: () => Promise.reject(rejection(403, 'PERMISSION_DENIED')),
    });
    expect(await streamChipsAfterAuditRead(container)).toEqual([]);
  });
});

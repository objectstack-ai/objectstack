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
 *  - ≥ 1120 px: details | the right column at 380 px, the details grid at
 *    three columns.
 *  - ≥ 760 px: details | the right column at 320 px, the details grid at two.
 *  - < 760 px (the split pane at 720, a phone at 390): ONE column, the details
 *    then the right column's panels in their order. No rail, and no tab
 *    strip but the record's own tab row under the header (Target 8), the
 *    same on every tier: 「概览」, 动态, then the related panels. On a phone
 *    (objectstack#27058: a 390 px window, not only a 390 px root) the stack
 *    is the same, and the header's actions sit in the bottom bar after it.
 *  - The embedded record (drawer / split pane) follows the same rule.
 *  - The right column opens with the 动态 panel, so History is read at open in
 *    every tier. `?tab=` addresses no strip (「概览」 stays the active tab);
 *    `?related=timeline` is the 动态 tab, the full stream.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
    fields: { ...BASE_FIELDS, project: { type: 'master_detail', reference: PARENT, label: 'Project' } },
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

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
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

function renderPage({ width, embedded = false, search = '', windowWidth = 1440 }: { width: number; embedded?: boolean; search?: string; windowWidth?: number }) {
  rootWidth = width;
  Object.defineProperty(window, 'innerWidth', { value: windowWidth, configurable: true, writable: true });
  dataSource = makeDataSource();
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
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}${search}`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource as never}
          objects={OBJECTS}
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
});

const shown = (container: HTMLElement) =>
  container.querySelector('[data-record-columns-shown]')?.getAttribute('data-record-columns-shown') ?? null;
const columnsGrid = (container: HTMLElement) =>
  container.querySelector('[data-record-columns]')?.getAttribute('class') ?? '';
/** The details' field grid, by the classes it draws (container queries). */
const detailsGrid = (container: HTMLElement) =>
  column(container, 'details')?.querySelector('[data-detail-section-face="frameless"] .grid')?.getAttribute('class') ?? '';
/** The right column's panels, in order: `timeline` for 动态, else the related card's id. */
const rightPanels = (container: HTMLElement) =>
  Array.from(column(container, 'right')?.querySelectorAll('[data-record-timeline-panel], [data-related-card-id]') ?? []).map(
    (el) => (el.hasAttribute('data-record-timeline-panel') ? 'timeline' : el.getAttribute('data-related-card-id')),
  );

/**
 * The page's only tablist is its tab row (objectstack#27524, Target 8): the
 * same tabs on every tier, the active one as `active`.
 */
const expectTabRowOnly = (active = 'overview') => {
  const lists = screen.getAllByRole('tablist');
  expect(lists).toHaveLength(1);
  expect(lists[0].closest('[data-record-tab-row]')).not.toBeNull();
  const tabs = Array.from(lists[0].querySelectorAll('[role="tab"]'));
  expect(tabs.map((tab) => tab.getAttribute('data-record-tab'))).toEqual([
    'overview',
    'timeline',
    'showcase_task.project',
    'showcase_note.project',
  ]);
  expect(lists[0].querySelector('[aria-selected="true"]')?.getAttribute('data-record-tab')).toBe(active);
};

describe('RecordDetailView — one record page, laid out by its width (objectstack#26678, objectstack#27524)', () => {
  it('1440 px: details beside the right column at 380 px, the details grid at three columns; 动态 leads; History is read at open', async () => {
    const { container } = renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('wide');
    expect(shown(container)).toBe('details right');
    expect(columnsGrid(container)).toContain('23.75rem');
    expect(detailsGrid(container)).toContain('@lg:grid-cols-3');
    expectTabRowOnly();
    expect(rightPanels(container)).toEqual(['timeline', 'showcase_task.project', 'showcase_note.project']);
    // No resident timeline column and no rail: the two columns are all.
    expect(column(container, 'timeline')).toBeNull();
    expect(column(container, 'related')).toBeNull();
    expect(screen.queryByTestId('record-related-rail-toggle')).toBeNull();
    // The header is drawn once.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
  });

  it('1200 px is wide too (the floor is 1120 px); 1100 px: the right column at 320 px, the details grid at two columns', async () => {
    const wide = renderPage({ width: 1200 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(wide.container)).toBe('wide');
    wide.unmount();

    const { container } = renderPage({ width: 1100 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('two-column');
    expect(shown(container)).toBe('details right');
    expect(columnsGrid(container)).toContain('20rem');
    expect(detailsGrid(container)).toContain('@sm:grid-cols-2');
    expect(detailsGrid(container)).not.toContain('@lg:grid-cols-3');
    // The same panels as the wide tier — no rail to open first.
    expect(rightPanels(container)).toEqual(['timeline', 'showcase_task.project', 'showcase_note.project']);
    expect(screen.queryByTestId('record-related-rail-toggle')).toBeNull();
    expectTabRowOnly();
  });

  it.each([
    ['the split pane', 720, 1440],
    ['a phone', 390, 390],
  ])('%s (%i px): one column — the details, then the 动态 panel and the related panels; the tab row; History is read at open', async (name, width, windowWidth) => {
    const { container } = renderPage({ width, windowWidth });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('stack');
    expect(shown(container)).toBe('details');
    expect(columnsGrid(container)).toContain('grid-cols-1');
    expectTabRowOnly();
    // The panels follow the details, in the right column's order.
    const details = column(container, 'details')!;
    const right = column(container, 'right')!;
    expect(details.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rightPanels(container)).toEqual(['timeline', 'showcase_task.project', 'showcase_note.project']);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
    // objectstack#27058 — on a phone the stack ends where the bottom action
    // bar starts: the header's actions are drawn there, after the body, and
    // the header draws no action row. The split pane keeps the header's row.
    const bar = container.querySelector('[data-record-action-bar]');
    const header = container.querySelector('[data-record-page-root] header') as HTMLElement;
    if (name === 'a phone') {
      await waitFor(() => expect(bar?.querySelector('[role="toolbar"]')).toBeTruthy());
      expect(right.compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(header.querySelector('[role="toolbar"]')).toBeNull();
    } else {
      expect(bar).toBeNull();
      await waitFor(() => expect(header.querySelector('[role="toolbar"]')).toBeTruthy());
    }
  });

  it('embedded (drawer / split pane): the same rule — two columns at 1440 px, one at 720 px', async () => {
    const wide = renderPage({ width: 1440, embedded: true });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(wide.container)).toBe('wide');
    expect(shown(wide.container)).toBe('details right');
    wide.unmount();

    const { container } = renderPage({ width: 720, embedded: true });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('stack');
    expectTabRowOnly();
  });

  it('`?tab=` addresses no strip on a laid-out page; `?related=timeline` is the 动态 tab: the full stream with its chips', async () => {
    const tabbed = renderPage({ width: 720, search: '?tab=related' });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(tabbed.container)).toBe('stack');
    expectTabRowOnly();
    expect(column(tabbed.container, 'details')).not.toBeNull();
    tabbed.unmount();

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
    expect(face.querySelector('[data-stream-filters]')).not.toBeNull();
    expect(face.querySelector('[data-record-timeline-peek]')).toBeNull();
    expectTabRowOnly('timeline');
    // The face takes the page: no columns under it.
    expect(container.querySelector('[data-record-columns]')).toBeNull();
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
  });
});

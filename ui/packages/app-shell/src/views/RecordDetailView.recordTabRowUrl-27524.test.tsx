/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Targets 8 and 9 — the record's tab row drives the
 * address, through a real `RecordDetailView` mount and the browser's own
 * history:
 *
 *  - leaving 「概览」 for a tab PUSHES one entry, `?related=object.field`
 *    (`?related=timeline` for 动态);
 *  - moving from tab to tab REPLACES that entry, so the history grows by one
 *    however many tabs the reader visits;
 *  - 「概览」, Esc and the browser's Back each return to the page in one step,
 *    and the header with its tab row stays drawn on every face.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
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

function renderPage({ width, embedded = false, search = '' }: { width: number; embedded?: boolean; search?: string }) {
  rootWidth = width;
  // The real browser history: the view reads the address bar it writes.
  window.history.replaceState(null, '', `/app/demo/${PARENT}/${RECORD_ID}${search}`);
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
    <BrowserRouter>
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
    </BrowserRouter>,
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
});

const search = () => new URLSearchParams(window.location.search).get('related');
const tab = (id: string) => document.querySelector(`[role="tab"][data-record-tab="${id}"]`) as HTMLElement;
const activeTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-record-tab') ?? null;
const face = () => document.querySelector('[data-related-enlarged]');

describe('RecordDetailView — the tab row drives the address (objectstack#27524, Targets 8 and 9)', () => {
  it('a tab pushes one entry, the next tab replaces it, 「概览」 returns in one step', async () => {
    renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    const start = window.history.length;
    expect(activeTab()).toBe('overview');

    fireEvent.click(tab('showcase_task.project'));
    await waitFor(() => expect(face()?.getAttribute('data-related-enlarged')).toBe('showcase_task.project'));
    expect(search()).toBe('showcase_task.project');
    expect(window.history.length).toBe(start + 1);
    expect(activeTab()).toBe('showcase_task.project');
    // The header is drawn once, above the row, on the enlarged face too.
    expect(document.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(tab('timeline'));
    await waitFor(() => expect(face()?.getAttribute('data-related-enlarged')).toBe('timeline'));
    expect(search()).toBe('timeline');
    fireEvent.click(tab('showcase_note.project'));
    await waitFor(() => expect(face()?.getAttribute('data-related-enlarged')).toBe('showcase_note.project'));
    expect(search()).toBe('showcase_note.project');
    // Three tabs visited, one entry.
    expect(window.history.length).toBe(start + 1);

    fireEvent.click(tab('overview'));
    await waitFor(() => expect(face()).toBeNull());
    await waitFor(() => expect(search()).toBeNull());
    expect(activeTab()).toBe('overview');
    expect(document.querySelector('[data-record-columns]')).not.toBeNull();
  });

  it('Esc on a tab returns to 「概览」, and so does the browser\'s Back', async () => {
    renderPage({ width: 720 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    fireEvent.click(tab('showcase_task.project'));
    fireEvent.click(await waitFor(() => tab('showcase_note.project')));
    await waitFor(() => expect(search()).toBe('showcase_note.project'));
    fireEvent.keyDown(face()!, { key: 'Escape' });
    await waitFor(() => expect(search()).toBeNull());
    await waitFor(() => expect(face()).toBeNull());

    fireEvent.click(tab('timeline'));
    await waitFor(() => expect(search()).toBe('timeline'));
    act(() => window.history.back());
    await waitFor(() => expect(search()).toBeNull());
    await waitFor(() => expect(face()).toBeNull());
    expect(activeTab()).toBe('overview');
  });

  it('a link to a tab opens it as the active tab; 「概览」 then replaces the address, with nothing to pop', async () => {
    renderPage({ width: 1440, search: '?related=showcase_task.project' });
    await waitFor(() => expect(face()?.getAttribute('data-related-enlarged')).toBe('showcase_task.project'), { timeout: 5000 });
    expect(activeTab()).toBe('showcase_task.project');
    const start = window.history.length;
    fireEvent.click(tab('overview'));
    await waitFor(() => expect(search()).toBeNull());
    expect(window.history.length).toBe(start);
    expect(window.location.pathname).toBe(`/app/demo/${PARENT}/${RECORD_ID}`);
  });
});

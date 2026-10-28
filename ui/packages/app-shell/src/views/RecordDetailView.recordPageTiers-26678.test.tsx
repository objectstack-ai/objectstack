/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 — the synthesized record page is one page at two widths.
 *
 * Measured from a real `RecordDetailView` mount (the `relatedListTitlePlural`
 * harness). The page takes its tier from the width of the container it
 * occupies — this view's root — and never from the viewport, so the root's
 * measured width is the one input varied here: every other element measures
 * as the test environment measures it.
 *
 *  - 1440 px: three resident columns, no tab strip; the related lists sit in
 *    the related column, and History is resident, so its read goes out at open.
 *  - 1100 px: two columns and the related toggle; the related lists are not
 *    mounted until the rail opens.
 *  - 900 px, and an embedded view at any width: the tab strip as before.
 *  - `?tab=` addresses the strip, so a column tier ignores it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

const OBJECTS = [
  {
    name: PARENT,
    label: 'Project',
    pluralLabel: 'Projects',
    managedBy: 'platform',
    // History is on for this object, so the synthesized page carries it.
    enable: { trackHistory: true },
    fields: BASE_FIELDS,
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
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Project ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

function renderPage({ width, embedded = false, search = '' }: { width: number; embedded?: boolean; search?: string }) {
  rootWidth = width;
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
});

describe('RecordDetailView — one record page at two widths (objectstack#26678)', () => {
  it('1440 px: three resident columns and no tab strip; History is read at open', async () => {
    const { container } = renderPage({ width: 1440 });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('three-column');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(column(container, 'details')).not.toBeNull();
    expect(column(container, 'timeline')).not.toBeNull();
    const related = column(container, 'related')!;
    expect(related.textContent).toContain('Tasks');
    expect(related.textContent).toContain('Notes');
    // The header is drawn once.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await waitFor(() => expect(auditReads()).toBeGreaterThan(0));
  });

  it('1100 px: two columns and the related toggle; the lists mount when the rail opens', async () => {
    const { container } = renderPage({ width: 1100 });
    // The rail toggle — not the crumb row's related-column switch (objectstack#27052).
    const toggle = await screen.findByTestId('record-related-rail-toggle', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('two-column');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(column(container, 'details')).not.toBeNull();
    expect(column(container, 'timeline')).not.toBeNull();
    expect(column(container, 'related')).toBeNull();
    expect(screen.queryByText('Tasks')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findAllByText('Tasks', undefined, { timeout: 5000 })).not.toHaveLength(0);
    expect(column(container, 'related')!.textContent).toContain('Notes');
  });

  it('900 px: the tab strip, as before; History waits for its tab', async () => {
    const { container } = renderPage({ width: 900 });
    expect(await screen.findByRole('tablist', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Details/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Related/ })).toBeTruthy();
    expect(tierOf(container)).toBeNull();
    expect(auditReads()).toBe(0);
  });

  it('embedded (drawer / split pane): the tab strip at any width', async () => {
    const { container } = renderPage({ width: 1440, embedded: true });
    expect(await screen.findByRole('tablist', undefined, { timeout: 5000 })).toBeTruthy();
    expect(tierOf(container)).toBeNull();
  });

  it('`?tab=` keeps working in the tabbed tier and is ignored in the column tiers', async () => {
    const tabbed = renderPage({ width: 900, search: '?tab=related' });
    const relatedTab = await screen.findByRole('tab', { name: /^Related/ }, { timeout: 5000 });
    expect(relatedTab.getAttribute('aria-selected')).toBe('true');
    tabbed.unmount();

    const { container } = renderPage({ width: 1440, search: '?tab=related' });
    await screen.findAllByText('Tasks', undefined, { timeout: 5000 });
    expect(tierOf(container)).toBe('three-column');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(column(container, 'details')).not.toBeNull();
  });
});

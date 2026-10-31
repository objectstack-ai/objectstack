/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27069 / objectstack#27241 — the record page's default related
 * order reads the object's declared `relatedLists`: a reader who never
 * arranged the related panels sees the cards in that order, the rest after
 * them in the derived order (owned `master_detail` children first, then
 * lookups). Measured from a real `RecordDetailView` mount at 1440 px, details
 * beside the right column (the `recordPageTiers-26678` harness: the root's
 * measured width is the one input varied).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
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
const BASE_FIELDS = { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } };

const objectsWith = (relatedLists?: string[]) => [
  {
    name: PARENT,
    label: 'Project',
    pluralLabel: 'Projects',
    managedBy: 'platform',
    ...(relatedLists ? { relatedLists } : {}),
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
  {
    name: 'showcase_call',
    label: 'Call',
    pluralLabel: 'Calls',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, project: { type: 'lookup', reference: PARENT, label: 'Project' } },
  },
];

function renderPage(objects: ReturnType<typeof objectsWith>) {
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
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Project ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource as never}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={PARENT}
          recordIdOverride={RECORD_ID}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const cardOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-record-column="right"] [data-related-card-id]')).map((el) =>
    el.getAttribute('data-related-card-id'),
  );

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 1440, bottom: 800, width: 1440, height: 800, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — the related cards follow the object\'s relatedLists (objectstack#27069)', () => {
  it('without relatedLists: the derived order — the owned child first, then the lookups in declaration order', async () => {
    const { container } = renderPage(objectsWith());
    await waitFor(() => expect(cardOrder(container)).toHaveLength(3), { timeout: 5000 });
    expect(cardOrder(container)).toEqual(['showcase_task.project', 'showcase_note.project', 'showcase_call.project']);
  });

  it('with relatedLists: the declared lists first in that order, the rest after them in the derived order', async () => {
    const { container } = renderPage(objectsWith(['showcase_call', 'showcase_note.project']));
    await waitFor(() => expect(cardOrder(container)).toHaveLength(3), { timeout: 5000 });
    expect(cardOrder(container)).toEqual(['showcase_call.project', 'showcase_note.project', 'showcase_task.project']);
  });
});

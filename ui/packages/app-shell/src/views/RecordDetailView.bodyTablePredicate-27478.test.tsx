/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27478 (ruling B on objectstack#27055) — which related lists the
 * record page draws as BODY TABLES is `@objectstack/spec`'s
 * `isBodyTableRelationship`, the predicate the spec's refusal of a field group
 * naming a side card reads too: `relatedList: 'primary'`, or a `master_detail`
 * FK that sets `inlineEdit` and declares no `relatedList`.
 *
 * Behaviour change pinned here: an inline-edited `master_detail` FK that
 * declares `relatedList: true` is a SIDE CARD, as the key's description says
 * ("write true to keep it a side card"). The page used to draw it as a body
 * table, because its own copy of the rule ignored `relatedList`.
 *
 * Measured from a real `RecordDetailView` mount at 1440 px, details beside
 * the right column (the `relatedListsOrder-27241` harness).
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

const PARENT = 'showcase_quote';
const RECORD_ID = 'q-1';
const BASE_FIELDS = { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } };

const objectsWith = (taskFk: Record<string, unknown>) => [
  {
    name: PARENT,
    label: 'Quote',
    pluralLabel: 'Quotes',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, name: { type: 'text', label: 'Name', group: 'basic' } },
    fieldGroups: [
      { key: 'basic', label: 'Basic' },
      { key: 'lines', label: 'Lines', relatedList: 'showcase_line' },
    ],
  },
  {
    name: 'showcase_line',
    label: 'Line',
    pluralLabel: 'Lines',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, quote: { type: 'master_detail', reference: PARENT, label: 'Quote', inlineEdit: 'grid' } },
  },
  {
    name: 'showcase_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, quote: { type: 'master_detail', reference: PARENT, label: 'Quote', inlineEdit: 'grid', ...taskFk } },
  },
  {
    name: 'showcase_note',
    label: 'Note',
    pluralLabel: 'Notes',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, quote: { type: 'lookup', reference: PARENT, label: 'Quote' } },
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
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Quote ${recordId}` })),
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

const detailsText = (container: HTMLElement) =>
  container.querySelector('[data-record-column="details"]')?.textContent ?? '';

describe('RecordDetailView — body tables are the spec predicate\'s verdict (objectstack#27478)', () => {
  it('an inline-edited master_detail with no relatedList is a body table; one with relatedList: true is a side card', async () => {
    const { container } = renderPage(objectsWith({ relatedList: true }));
    await waitFor(() => expect(cardOrder(container)).toHaveLength(2), { timeout: 5000 });
    expect(cardOrder(container)).toEqual(['showcase_task.quote', 'showcase_note.quote']);
    expect(detailsText(container)).toContain('Lines');
    expect(detailsText(container)).not.toContain('Tasks');
  });

  it('control: the same FK with no relatedList is a body table, not a card', async () => {
    const { container } = renderPage(objectsWith({}));
    await waitFor(() => expect(cardOrder(container)).toHaveLength(1), { timeout: 5000 });
    expect(cardOrder(container)).toEqual(['showcase_note.quote']);
    await waitFor(() => expect(detailsText(container)).toContain('Tasks'), { timeout: 5000 });
    expect(detailsText(container)).toContain('Lines');
  });
});

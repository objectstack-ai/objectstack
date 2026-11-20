/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28909 — the owner is named somewhere on the page at every width,
 * and once. From a real `RecordDetailView` mount (the `phoneFace-27058`
 * harness), with `owner_id` declared 5th in `highlightFields`, behind four
 * non-text highlights (so the phone subtitle takes none of them):
 *
 *  - until objectstack#35891 the phone header drew four highlights (the
 *    owner past them, so the meta line named it) and the desktop strip all
 *    five (the strip named the owner, the meta line did not);
 *  - the default page draws no strip now, so at 390 px and at 1440 px the
 *    meta line names the owner.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const APP = 'demo';
const LEAD = 'crm_lead';

const OBJECTS = [
  {
    name: LEAD,
    label: 'Lead',
    pluralLabel: 'Leads',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      email: { type: 'email', label: 'Email' },
      status: { type: 'select', label: 'Status', options: [{ value: 'new', label: 'New' }] },
      phone: { type: 'phone', label: 'Phone' },
      website: { type: 'url', label: 'Website' },
      owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
    },
    // The title field first (it is the page's name, never a highlight), then
    // four non-text highlights, then the owner, 5th.
    highlightFields: ['name', 'email', 'status', 'phone', 'website', 'owner_id'],
  },
];

const LEAD_ROW = {
  name: 'Mira Costa',
  email: 'mira@atlas.test',
  status: 'new',
  phone: '555-0100',
  website: 'https://atlas.test',
  owner_id: { id: 'u-ada', name: 'Ada Admin' },
  created_at: '2026-10-16T00:00:00Z',
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
    findOne: vi.fn(async (_objectName: string, recordId: string) => ({ id: recordId, ...LEAD_ROW })),
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

function mountPage() {
  render(
    <MemoryRouter initialEntries={[`/apps/${APP}/${LEAD}/record/r-1`]}>
      <MetadataCtx.Provider value={metadataFor(OBJECTS)}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={makeDataSource() as never} objects={OBJECTS} onEdit={() => {}} />}
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** The meta line, once the record has loaded. */
async function metaLineLoaded(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const metaLine = document.querySelector('[data-testid="record-meta-footer"]') as HTMLElement | null;
      expect(metaLine).toBeTruthy();
      // The record has loaded: its values are on the page.
      expect(document.body.textContent).toContain('mira@atlas.test');
      return metaLine!;
    },
    { timeout: 5000 },
  );
}

const ownerEntry = (metaLine: HTMLElement) => metaLine.querySelector('[data-record-meta-owner]');

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

describe('the owner at every width, once (objectstack#28909)', () => {
  // Until objectstack#35891 the default page drew a strip of the declared
  // highlights: four on a phone (the owner past them, so the meta line named
  // it) and all five on a desktop (the strip named the owner, the meta line
  // did not). The default page draws no strip now, at any width, so the meta
  // line names the owner at both.
  it.each([
    ['a phone', 390],
    ['a desktop', 1440],
  ])('on %s: no strip, and the meta line names the owner', async (_face, width) => {
    setWidth(width);
    mountPage();
    const metaLine = await metaLineLoaded();
    expect(document.querySelector('[data-highlights-face]')).toBeNull();
    const owner = ownerEntry(metaLine);
    expect(owner).toBeTruthy();
    expect(owner!.textContent).toContain('Ada Admin');
    // The rest of the meta line is still drawn.
    expect(metaLine.querySelector('[data-record-meta-id]')!.textContent).toBe('r-1');
  });
});

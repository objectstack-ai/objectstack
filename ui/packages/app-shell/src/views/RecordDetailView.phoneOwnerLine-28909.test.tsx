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
 *  - at 390 px the phone header draws four highlights after its subtitle, so
 *    the owner is not in the strip and the meta line names it;
 *  - at 1440 px the strip draws all five, the owner among them, and the meta
 *    line leaves it out (objectstack#28868, the owner once).
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

/** The strip and the meta line, once both are drawn. */
async function stripAndMetaLine(): Promise<{ strip: HTMLElement; metaLine: HTMLElement }> {
  return waitFor(
    () => {
      const strip = document.querySelector('[data-highlights-face]') as HTMLElement | null;
      const metaLine = document.querySelector('[data-testid="record-meta-footer"]') as HTMLElement | null;
      expect(strip).toBeTruthy();
      expect(metaLine).toBeTruthy();
      // The record has loaded: the strip shows its values.
      expect(strip!.textContent).toContain('mira@atlas.test');
      return { strip: strip!, metaLine: metaLine! };
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
  it('on a phone: owner_id declared 5th is past the header\'s four, so the meta line names the owner', async () => {
    mountPage();
    const { strip, metaLine } = await stripAndMetaLine();
    // The phone header: four highlights, the owner not among them.
    expect(strip.children).toHaveLength(4);
    expect(strip.textContent).not.toContain('Ada Admin');
    const owner = ownerEntry(metaLine);
    expect(owner).toBeTruthy();
    expect(owner!.textContent).toContain('Ada Admin');
  });

  it('on a desktop: the strip names the owner and the meta line does not', async () => {
    setWidth(1440);
    mountPage();
    const { strip, metaLine } = await stripAndMetaLine();
    expect(strip.children).toHaveLength(5);
    expect(strip.textContent).toContain('Ada Admin');
    expect(ownerEntry(metaLine)).toBeNull();
    // The rest of the meta line is still drawn.
    expect(metaLine.querySelector('[data-record-meta-id]')!.textContent).toBe('r-1');
  });
});

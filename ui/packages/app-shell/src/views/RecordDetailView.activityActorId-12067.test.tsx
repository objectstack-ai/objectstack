/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12067 — the console record page's activity feed names the user
 * behind a `sys_activity` row that carries `actor_id` and no `actor_name`.
 *
 * On `@objectstack/*` 17.7.0 the audit writer fills `actor_id` (a lookup to
 * `sys_user`) and never `actor_name` (objectstack#22510). The page builds its
 * feed items with `activityRowToFeedItem`, which read `actor_name` alone, so
 * every such row read "System". The constructor now names the expanded
 * `actor_id`, and this page's `sys_activity` read asks for that expansion.
 *
 * The data source answers the way objectql does: a read that passes
 * `$expand: ['actor_id']` gets the user's record in place of the id, and a
 * read without it gets the bare id, so the pin goes red if the page stops
 * asking.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u-me', name: 'Viewer', image: null }, activeOrganization: null }),
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

// Orthogonal chrome, stubbed so the only asynchrony in this file is the feed.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_lead';
const RECORD_ID = 'rec-1';
const ADA = { id: 'u-ada', name: 'Ada Lovelace' };

const ACTIVITY_ROWS = [
  {
    id: 'a-1',
    type: 'updated',
    summary: 'Stage changed',
    timestamp: '2026-01-02T00:00:00.000Z',
    actor_id: 'u-ada',
  },
];

function makeDataSource() {
  return {
    find: vi.fn((objectName: string, params: { $expand?: string[] } = {}) =>
      Promise.resolve({
        data:
          objectName === 'sys_activity'
            ? ACTIVITY_ROWS.map((r) =>
                params.$expand?.includes('actor_id') ? { ...r, actor_id: ADA } : { ...r },
              )
            : [],
      }),
    ),
    create: vi.fn(async (_o: string, row: any) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({
      id: recordId,
      name: `Record ${recordId}`,
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Lead',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

function makeMetadata() {
  return {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

beforeEach(() => {
  cleanup();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Unrelated chrome (approvals, favourites…) reaches for the platform API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the record page feed names the actor of an id-only activity row (objectui#12067)', () => {
  it('reads `sys_activity` with `actor_id` expanded and shows the user, not "System"', async () => {
    const dataSource = makeDataSource();
    render(
      <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
        <MetadataCtx.Provider value={makeMetadata()}>
          <RecordDetailView
            dataSource={dataSource}
            objects={OBJECTS}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Stage changed')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText('System')).toBeNull();

    await waitFor(() => {
      const reads = dataSource.find.mock.calls.filter((c: unknown[]) => c[0] === 'sys_activity');
      expect(reads).toHaveLength(1);
      expect(reads[0][1].$expand).toEqual(['actor_id']);
    });
  });
});

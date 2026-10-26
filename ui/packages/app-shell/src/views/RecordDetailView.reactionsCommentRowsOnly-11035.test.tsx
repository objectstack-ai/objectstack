// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * No `sys_comment` write is ever keyed by a `sys_activity` id (objectui#11035).
 *
 * The record page's discussion panel merges two reads, `sys_comment` rows (feed
 * kind `comment`) and `sys_activity` rows (a field change, a task, a system
 * event). A reaction is stored only in `sys_comment.reactions`, and the page's
 * reaction handler writes `sys_comment` by whatever id it is handed. The panel
 * used to offer Add reaction on the activity rows too, so picking an emoji
 * there sent `update('sys_comment', ACTIVITY_ID, …)`: a failed write, or, on an
 * id collision, a write to an unrelated comment.
 *
 * Real subjects: `RecordDetailView` rendering a record page that composes
 * `record:discussion`, the real `RecordActivityTimeline` / `ReactionPicker`,
 * over a fake data source answering one `sys_comment` row and one
 * `sys_activity` row. The observed channel is the data source's `update` calls.
 * A small probe mounted on the same page reads the page's `DiscussionContext`,
 * so the handler is also driven with an id no panel control hands it any more.
 *
 * Since objectui#12078 this runs on the column store, which the page uses only
 * where the deployment has no `sys_comment_reaction` (the registry below lists
 * none). The handler refuses a non-comment id before it picks a store, so the
 * reaction-row store is refused the same id by the same check.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, useDiscussionContext } from '@object-ui/react';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'u1', image: null }, activeOrganization: null }),
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

const ADD_REACTION = DETAIL_DEFAULT_TRANSLATIONS['detail.addReaction'];
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';
const COMMENT_ID = 'c1';
const COMMENT_BODY = 'Signed the renewal';
const ACTIVITY_ID = 'a1';
const ACTIVITY_SUMMARY = 'Created the record';
const PROBE = 'test:reaction-handler-probe-11035';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Customer',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

/**
 * Hands the page's reaction handler an id directly, the way any consumer of
 * `DiscussionContext` can: one button per feed id.
 */
const HandlerProbe: React.FC = () => {
  const discussion = useDiscussionContext();
  return (
    <div>
      {[COMMENT_ID, ACTIVITY_ID].map((id) => (
        <button key={id} type="button" onClick={() => discussion?.onToggleReaction?.(id, '👍')}>
          {`probe react ${id}`}
        </button>
      ))}
    </div>
  );
};

function page(withProbe: boolean) {
  return {
    name: 'customer_record_page',
    type: 'record',
    object: OBJECT_NAME,
    regions: [
      {
        name: 'main',
        components: [
          { type: 'page:header', title: 'Customer' },
          { type: 'record:discussion' },
          ...(withProbe ? [{ type: PROBE }] : []),
        ],
      },
    ],
  };
}

/** One stored comment and one `sys_activity` row for the record. Every `update` is stored. */
function makeDataSource() {
  const comment = {
    id: COMMENT_ID,
    thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
    author_name: 'Grace',
    body: COMMENT_BODY,
    created_at: '2026-09-28T08:00:00.000Z',
  };
  const activity = {
    id: ACTIVITY_ID,
    type: 'created',
    summary: ACTIVITY_SUMMARY,
    actor_name: 'Ada',
    object_name: OBJECT_NAME,
    record_id: RECORD_ID,
    timestamp: '2026-09-28T07:00:00.000Z',
  };
  return {
    find: vi.fn((objectName: string) =>
      Promise.resolve({
        data: objectName === 'sys_comment' ? [comment] : objectName === 'sys_activity' ? [activity] : [],
      }),
    ),
    create: vi.fn(async (_o: string, created: unknown) => created),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

async function mount(dataSource: any, { withProbe = false } = {}) {
  const pages = [page(withProbe)];
  const metadata = {
    objects: OBJECTS,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    // The registry lists this deployment's objects, and `sys_comment_reaction`
    // is not one of them, so the page keeps reactions in the
    // `sys_comment.reactions` column (objectui#12078).
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? OBJECTS : []),
  } as any;
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
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
  // Both reads have landed: the comment row and the activity row are on screen.
  await screen.findByText(COMMENT_BODY);
  await screen.findByText(ACTIVITY_SUMMARY);
}

/** The content column of the row whose body reads `body`: where its reaction controls render. */
function row(body: string): HTMLElement {
  const content = screen.getByText(body).parentElement;
  if (!content) throw new Error(`no row for "${body}"`);
  return content;
}

/** Runs a click, then lets the write it issued settle before going on. */
async function click(run: () => void) {
  run();
  await act(async () => {});
}

/** Every `[object, id]` the data source was asked to update. */
function updatedKeys(dataSource: any): Array<[string, string]> {
  return dataSource.update.mock.calls.map(([objectName, id]: [string, string]) => [objectName, id]);
}

beforeAll(() => {
  ComponentRegistry.register(PROBE, HandlerProbe as never);
});

afterAll(() => {
  ComponentRegistry.unregister(PROBE);
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('no `sys_comment` write is ever keyed by a `sys_activity` id (objectui#11035)', () => {
  it('the activity row shows no Add reaction button, and the comment row shows one', async () => {
    await mount(makeDataSource());
    expect(screen.getAllByRole('button', { name: ADD_REACTION })).toHaveLength(1);
    expect(within(row(ACTIVITY_SUMMARY)).queryByRole('button', { name: ADD_REACTION })).toBeNull();
    expect(within(row(COMMENT_BODY)).getByRole('button', { name: ADD_REACTION })).toBeInTheDocument();
  });

  it('picking an emoji through every Add reaction on the panel writes `sys_comment` by the comment id only', async () => {
    const dataSource = makeDataSource();
    await mount(dataSource);
    const offered = screen.getAllByRole('button', { name: ADD_REACTION }).length;
    for (let i = 0; i < offered; i++) {
      // Re-queried each time: a stored click re-renders the panel.
      await click(() => fireEvent.click(screen.getAllByRole('button', { name: ADD_REACTION })[i]));
      await click(() => fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '👍' })));
    }
    const keys = updatedKeys(dataSource);
    expect(keys.map(([, id]) => id)).not.toContain(ACTIVITY_ID);
    expect(keys).toEqual([['sys_comment', COMMENT_ID]]);
    const [, , patch] = dataSource.update.mock.calls[0];
    expect(JSON.parse(patch.reactions)).toEqual({ '👍': ['u1'] });
  });

  it('the page handler refuses an activity id without a write, and still writes a comment id', async () => {
    const dataSource = makeDataSource();
    await mount(dataSource, { withProbe: true });

    await click(() => fireEvent.click(screen.getByRole('button', { name: `probe react ${ACTIVITY_ID}` })));
    expect(dataSource.update).not.toHaveBeenCalled();

    // CONTROL: the same probe reaches the handler, and a comment id is written.
    await click(() => fireEvent.click(screen.getByRole('button', { name: `probe react ${COMMENT_ID}` })));
    expect(updatedKeys(dataSource)).toEqual([['sys_comment', COMMENT_ID]]);
  });
});

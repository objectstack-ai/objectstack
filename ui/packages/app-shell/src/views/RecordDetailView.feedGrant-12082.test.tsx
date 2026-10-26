// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record feed's writes read the affordance-to-grant map (objectui#12082,
 * the census backlog's leg B).
 *
 * The feed offered its comment composer and its reaction control to every
 * caller, and read no grant: the composer is drawn from `onAddComment`'s
 * presence and the reaction picker from `onToggleReaction`'s, and the record
 * page handed both over unconditionally. Neither object the feed writes is a
 * platform default — the `everyone` baseline names neither `sys_comment` nor
 * `sys_comment_reaction`, an application grants them in its own sets — so a
 * member whose sets do not was offered a composer whose post the server
 * refused at its object CRUD step. Now each write is handed over only where its
 * row allows it, asked of the object it writes:
 *
 *  - the composer: `feedComment`, the create grant on `sys_comment`;
 *  - the reaction control: `feedReactionAdd`, the create grant on
 *    `sys_comment_reaction`, with a take-back asking `feedReactionRemove`, its
 *    delete grant, per click;
 *  - on a deployment with no `sys_comment_reaction` (the column store), the
 *    reaction control: `feedReactionColumn`, the update grant on `sys_comment`.
 *
 * Real subjects: `RecordDetailView` rendering a record page that composes
 * `record:discussion`, under the REAL `MePermissionsProvider` holding the
 * caller's `/me/permissions` answer, driven through the real panel.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';
import { effectiveOperationsArray, resolveEffectiveApiMethods } from '@objectstack/spec/data';

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

const COMMENT = 'sys_comment';
const REACTION = 'sys_comment_reaction';
const COMMENT_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.leaveCommentPlaceholder'];
const ADD_REACTION = DETAIL_DEFAULT_TRANSLATIONS['detail.addReaction'];
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;
const COMMENT_ID = 'c1';
const COMMENT_BODY = 'Signed the renewal';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Customer',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

const PAGE = {
  name: 'customer_record_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    { name: 'main', components: [{ type: 'page:header', title: 'Customer' }, { type: 'record:discussion' }] },
  ],
};

/** The object registry: with the reaction object (the records store), or without it (the column store). */
const REGISTRY = {
  records: [...OBJECTS, { name: REACTION, label: 'Comment Reaction' }],
  column: OBJECTS,
};

/** The four grant shapes of the map's enumeration pin, as `/me/permissions` carries them. */
const SHAPE = {
  createOnly: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  editOnly: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
  readOnly: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  full: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
} as const;

type Bits = Record<string, unknown>;

/** The caller's answer: full on the record's own object, `feed` on the feed's objects (absent keys are absent). */
function answer(feed: { [COMMENT]?: Bits; [REACTION]?: Bits }): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: ['member'],
    permissionSets: ['member'],
    objects: { [OBJECT_NAME]: SHAPE.full, ...feed },
    fields: {},
  } as MePermissionsResponse;
}

/** One comment by another member; the caller (`u1`) has already reacted 👍 on it. */
function makeDataSource() {
  const comment = {
    id: COMMENT_ID,
    thread_id: THREAD,
    author_id: 'u3',
    author_name: 'u3',
    body: COMMENT_BODY,
    created_at: '2026-10-10T08:00:00.000Z',
    reactions: JSON.stringify({ '👍': ['u1'] }),
  };
  const ownReaction = { id: 'r1', comment_id: COMMENT_ID, emoji: '👍', user_id: 'u1', created_at: '2026-10-10T09:00:00.000Z' };
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === COMMENT) return { data: [{ ...comment }] };
      if (objectName === REACTION) return { data: [{ ...ownReaction }] };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    create: vi.fn(async (_o: string, data: any) => ({ id: 'new-row', ...data })),
    update: vi.fn(async (_o: string, id: string, patch: any) => ({ id, ...patch })),
    delete: vi.fn(async () => true),
  } as any;
}

function metadataFor(objects: unknown[]) {
  const pages = [PAGE];
  return {
    objects,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? objects : []),
    getTypeStatus: () => 'ready',
  } as any;
}

/**
 * Mounts the record page and waits for the comment to show. `perms` null is
 * the no-provider host (a standalone embed), where every grant reads open.
 * `objects` is the page's `objects` prop, the schemas the feed's gates read.
 */
async function mount(
  perms: MePermissionsResponse | null,
  dataSource = makeDataSource(),
  registry: unknown[] = REGISTRY.records,
  objects: unknown[] = OBJECTS,
) {
  const page = (
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadataFor(registry)}>
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
  const view = render(perms ? <MePermissionsProvider initialPermissions={perms}>{page}</MePermissionsProvider> : page);
  const scope = within(view.container);
  await scope.findByText(COMMENT_BODY);
  await act(async () => {});
  return { view: scope, dataSource };
}

type View = Awaited<ReturnType<typeof mount>>['view'];

const composer = (view: View) => view.queryByPlaceholderText(COMMENT_PLACEHOLDER);
const addReaction = (view: View) => view.queryByRole('button', { name: ADD_REACTION });
/** The caller's own 👍 chip: a labelled button holding the emoji and its count. */
const thumbsChip = (view: View) =>
  (view.queryAllByRole('button') as HTMLElement[]).find(
    (b) => !!b.getAttribute('aria-label') && b.children.length === 2 && b.children[0].textContent === '👍',
  );

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

describe("the record feed's comment composer reads feedComment: create on sys_comment (objectui#12082)", () => {
  it.each([
    ['create-only', SHAPE.createOnly, true],
    ['edit-only', SHAPE.editOnly, false],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('under a %s grant on sys_comment the composer shows exactly when create is held', async (_shape, bits, shown) => {
    const { view } = await mount(answer({ [COMMENT]: bits, [REACTION]: SHAPE.full }));
    expect(!!composer(view)).toBe(shown);
  });

  it('a caller whose sets name no sys_comment at all is offered no composer — the server refuses that post as ungranted', async () => {
    const { view } = await mount(answer({ [REACTION]: SHAPE.full }));
    expect(composer(view)).toBeNull();
  });

  it('an effective operation set without create closes it, whatever the grant', async () => {
    const { view } = await mount(answer({ [COMMENT]: { ...SHAPE.full, apiOperations: ['get', 'list', 'update'] }, [REACTION]: SHAPE.full }));
    expect(composer(view)).toBeNull();
  });

  it('CONTROL — with no permission provider the composer shows, as before', async () => {
    const { view } = await mount(null);
    expect(composer(view)).not.toBeNull();
  });
});

describe("the record feed's reaction control reads feedReactionAdd / feedReactionRemove on the records store (objectui#12082)", () => {
  it.each([
    ['create-only', SHAPE.createOnly, true],
    ['edit-only', SHAPE.editOnly, false],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('under a %s grant on sys_comment_reaction the control is offered exactly when create is held', async (_shape, bits, offered) => {
    const { view } = await mount(answer({ [COMMENT]: SHAPE.full, [REACTION]: bits }));
    expect(!!addReaction(view)).toBe(offered);
    // Withheld, the existing chips render disabled (the panel's own rule for a
    // row with no handler).
    expect(thumbsChip(view)).toBeDefined();
    expect((thumbsChip(view) as HTMLButtonElement).disabled).toBe(!offered);
  });

  it('a take-back asks the delete grant: with create but not delete, clicking the own reaction writes nothing and keeps it shown', async () => {
    const { view, dataSource } = await mount(answer({ [COMMENT]: SHAPE.full, [REACTION]: SHAPE.createOnly }));
    fireEvent.click(thumbsChip(view)!);
    await act(async () => {});
    expect(dataSource.delete).not.toHaveBeenCalled();
    expect(thumbsChip(view)!.children[1].textContent).toBe('1');
  });

  it('CONTROL — with the delete grant the same click takes the reaction back by deleting the own row', async () => {
    const { view, dataSource } = await mount(answer({ [COMMENT]: SHAPE.full, [REACTION]: SHAPE.full }));
    fireEvent.click(thumbsChip(view)!);
    await act(async () => {});
    expect(dataSource.delete.mock.calls).toEqual([[REACTION, 'r1']]);
  });

  it('adding through the picker creates the own row where create is held', async () => {
    const { view, dataSource } = await mount(answer({ [COMMENT]: SHAPE.readOnly, [REACTION]: SHAPE.createOnly }));
    fireEvent.click(addReaction(view)!);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '🎉' }));
    await act(async () => {});
    expect(dataSource.create.mock.calls).toEqual([[REACTION, { comment_id: COMMENT_ID, emoji: '🎉' }]]);
  });
});

/**
 * The two feed objects as objectstack registers them (`plugin-audit`): their
 * policy keys (`managedBy`, `userActions`) and the `enable` block the server
 * derives the effective operation set from. The other cases pass an `objects`
 * prop holding neither, so the policy leg there reads the default bucket.
 */
const REGISTERED_COMMENT = {
  name: COMMENT,
  label: 'Comment',
  managedBy: 'platform',
  enable: { trackHistory: true, searchable: true, apiEnabled: true, clone: false },
};
const REGISTERED_REACTION = {
  name: REACTION,
  label: 'Comment Reaction',
  managedBy: 'platform',
  userActions: { edit: false, import: false },
  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'delete', 'bulk'],
    feeds: false,
    activities: false,
    clone: false,
  },
};

describe('against the registered feed schemas in the page objects (objectui#12082)', () => {
  it("under a full grant the registered policy closes nothing the feed offers: the composer, the reaction add and the take-back are each offered", async () => {
    // The reaction object's effective operation set, derived by the spec from
    // its `enable` block (no export grant is held, as in `SHAPE.full`).
    const reactionOperations = effectiveOperationsArray(
      resolveEffectiveApiMethods(REGISTERED_REACTION.enable, { userExportAllowed: false }),
    );
    const { view, dataSource } = await mount(
      answer({ [COMMENT]: SHAPE.full, [REACTION]: { ...SHAPE.full, apiOperations: reactionOperations } }),
      makeDataSource(),
      [...OBJECTS, REGISTERED_COMMENT, REGISTERED_REACTION],
      [...OBJECTS, REGISTERED_COMMENT, REGISTERED_REACTION],
    );
    expect(composer(view)).not.toBeNull();
    expect(addReaction(view)).not.toBeNull();
    fireEvent.click(thumbsChip(view)!);
    await act(async () => {});
    expect(dataSource.delete.mock.calls).toEqual([[REACTION, 'r1']]);
  });
});

describe('on the column store the reaction control reads feedReactionColumn: update on sys_comment (objectui#12082)', () => {
  it.each([
    ['create-only', SHAPE.createOnly, false],
    ['edit-only', SHAPE.editOnly, true],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('under a %s grant on sys_comment the control is offered exactly when update is held', async (_shape, bits, offered) => {
    const { view } = await mount(answer({ [COMMENT]: bits }), makeDataSource(), REGISTRY.column);
    expect(!!addReaction(view)).toBe(offered);
  });
});

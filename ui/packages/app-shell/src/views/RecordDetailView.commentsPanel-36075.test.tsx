// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36075 — the record's comments move out of the 动态 tab into a
 * panel of their own, opened from a comments icon in the record header.
 *
 * Pinned through the REAL `RecordDetailView`:
 *
 * - The icon is in the header of the default record page, with the number of
 *   top-level comments; a press opens 「评论」 and the next one closes it.
 * - Whether the panel is open is kept in this browser: a record opened later
 *   opens with the panel as it was left.
 * - Where it is drawn: beside the record from a 1280 window (the record gives
 *   way), over the record's right edge in a narrower one, and over the whole
 *   body of a drawer too narrow to split.
 * - The comments are the panel's: the page's 动态 stream no longer draws them.
 * - No icon where the panel is not offered: an object with feeds off, and a
 *   page authored by hand (option C, seat 13:24Z): that page keeps its own
 *   discussion block as it was.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u-ada', name: 'Ada', image: null }, activeOrganization: null }),
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
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_case';
const NO_FEEDS = 'crm_note';
const RECORD_ID = 'case-41';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

const ADA_BODY = 'Ada: customer called back about the outage';
const GRACE_BODY = 'Grace: escalated to tier two';
const REPLY_BODY = 'Grace: tier two confirmed';

const ROWS = [
  { id: 'c-ada', thread_id: THREAD, author_id: 'u-ada', author_name: 'Ada', body: ADA_BODY, created_at: '2026-10-01T08:00:00.000Z' },
  { id: 'c-grace', thread_id: THREAD, author_id: 'u-grace', author_name: 'Grace', body: GRACE_BODY, created_at: '2026-10-01T09:00:00.000Z' },
  {
    id: 'c-reply',
    thread_id: THREAD,
    parent_id: 'c-ada',
    author_id: 'u-grace',
    author_name: 'Grace',
    body: REPLY_BODY,
    created_at: '2026-10-01T10:00:00.000Z',
  },
];

const FIELDS = { id: { type: 'text', label: 'Id' }, subject: { type: 'text', label: 'Subject' } };
const OBJECTS = [
  { name: OBJECT_NAME, label: 'Case', fields: FIELDS },
  { name: NO_FEEDS, label: 'Note', fields: FIELDS, enable: { feeds: false } },
];

const AUTHORED_PAGE = {
  name: 'case_detail_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    {
      name: 'main',
      components: [{ type: 'page:header', properties: { title: '{subject}' } }, { type: 'record:discussion' }],
    },
  ],
};

function makeDataSource() {
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === 'sys_comment') return { data: ROWS.map((r) => ({ ...r })) };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, subject: `Case ${id}` })),
    create: vi.fn(async (_o: string, data: any) => ({ id: 'c-new', ...data })),
    update: vi.fn(async (_o: string, id: string, patch: any) => ({ id, ...patch })),
    delete: vi.fn(async () => true),
  } as any;
}

function metadataFor(pages: unknown[]) {
  return {
    objects: OBJECTS,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? OBJECTS : []),
    getTypeStatus: () => 'ready',
  } as any;
}

const FULL = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const PERMS = {
  authenticated: true,
  userId: 'u-ada',
  tenantId: null,
  positions: ['member'],
  hasAnyQueue: false,
  objectsUsingQueues: [],
  permissionSets: ['member'],
  objects: { [OBJECT_NAME]: FULL, [NO_FEEDS]: FULL, sys_comment: FULL },
  fields: {},
} as MePermissionsAuthenticatedResponse;

interface MountOptions {
  objectName?: string;
  pages?: unknown[];
  embedded?: boolean;
}

async function mount({ objectName = OBJECT_NAME, pages = [], embedded = false }: MountOptions = {}) {
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={PERMS}>
        <MemoryRouter initialEntries={[`/app/service/${objectName}/${RECORD_ID}`]}>
          <MetadataCtx.Provider value={metadataFor(pages)}>
            <RecordDetailView
              dataSource={makeDataSource()}
              objects={OBJECTS}
              onEdit={() => {}}
              objectNameOverride={objectName}
              recordIdOverride={RECORD_ID}
              embedded={embedded}
            />
          </MetadataCtx.Provider>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  await within(rendered.container).findByText(`Case ${RECORD_ID}`, undefined, { timeout: 4000 }).catch(() => undefined);
  await act(async () => {});
  return rendered;
}

const button = (root: HTMLElement) => root.querySelector('[data-comments-button]') as HTMLButtonElement | null;
const panel = (root: HTMLElement) => root.querySelector('[data-comments-panel]') as HTMLElement | null;
const placement = (root: HTMLElement) =>
  root.querySelector('[data-comments-placement]')?.getAttribute('data-comments-placement') ?? null;

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  window.localStorage.clear();
  setWindowWidth(1440);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the record comment panel (objectstack#36075)', () => {
  it('the default page header carries the icon with the number of top-level comments', async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    await waitFor(() => expect(button(container)!.querySelector('[data-comments-count]')).toHaveTextContent('2'));
    expect(button(container)).toHaveAttribute('aria-pressed', 'false');
    expect(panel(container)).toBeNull();
  });

  it('a press opens the panel beside the record from a 1280 window, the next press closes it', async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    fireEvent.click(button(container)!);
    expect(panel(container)).not.toBeNull();
    expect(placement(container)).toBe('beside');
    expect(button(container)).toHaveAttribute('aria-pressed', 'true');
    const p = within(panel(container)!);
    expect(await p.findByText(ADA_BODY)).toBeInTheDocument();
    expect(p.getByText(GRACE_BODY)).toBeInTheDocument();
    fireEvent.click(button(container)!);
    expect(panel(container)).toBeNull();
  });

  it('the panel draws over the record in a window under 1280', async () => {
    setWindowWidth(1100);
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    fireEvent.click(button(container)!);
    expect(placement(container)).toBe('over');
  });

  it('the panel is kept open in this browser for the next record opened', async () => {
    const first = await mount();
    await waitFor(() => expect(button(first.container)).not.toBeNull());
    fireEvent.click(button(first.container)!);
    cleanup();
    const second = await mount();
    await waitFor(() => expect(panel(second.container)).not.toBeNull());
  });

  it('a drawer too narrow to split gives the panel its whole body, and remembers it apart from the page', async () => {
    const page = await mount();
    await waitFor(() => expect(button(page.container)).not.toBeNull());
    fireEvent.click(button(page.container)!);
    cleanup();
    const drawer = await mount({ embedded: true });
    await waitFor(() => expect(button(drawer.container)).not.toBeNull());
    // The page was left open; the drawer opens closed.
    expect(panel(drawer.container)).toBeNull();
    fireEvent.click(button(drawer.container)!);
    expect(placement(drawer.container)).toBe('cover');
  });

  it('the 动态 stream no longer draws the comments', async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    await act(async () => {});
    expect(within(container).queryByText(ADA_BODY)).toBeNull();
    fireEvent.click(button(container)!);
    expect(await within(panel(container)!).findByText(ADA_BODY)).toBeInTheDocument();
    // Exactly once on the page: in the panel.
    expect(within(container).getAllByText(ADA_BODY)).toHaveLength(1);
  });

  it('no icon on an object with feeds off', async () => {
    const { container } = await mount({ objectName: NO_FEEDS });
    await act(async () => {});
    expect(button(container)).toBeNull();
  });

  it('no icon on a hand-written page, which keeps its own discussion block', async () => {
    const { container } = await mount({ pages: [AUTHORED_PAGE], embedded: true });
    expect(await within(container).findByText(ADA_BODY)).toBeInTheDocument();
    expect(button(container)).toBeNull();
    expect(panel(container)).toBeNull();
  });
});

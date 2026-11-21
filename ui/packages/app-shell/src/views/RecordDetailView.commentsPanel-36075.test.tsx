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
 *   discussion block as it was. It is drawn on the desktop full page only
 *   (objectstack#36150): the same object's drawer draws the standard page,
 *   which offers the icon.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
import { toast } from 'sonner';
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
  /** The record route's query, `?comments=…` for the phone's comment page. */
  search?: string;
}

/** The router's location now, for the phone's `?comments=` entries. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location" data-search={location.search} data-pushed={String(!!(location.state as any)?.__commentsPushed)} />;
}

async function mount({ objectName = OBJECT_NAME, pages = [], embedded = false, search = '' }: MountOptions = {}) {
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={PERMS}>
        <MemoryRouter initialEntries={[`/app/service/${objectName}/${RECORD_ID}${search}`]}>
          <LocationProbe />
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

  it("Delete in the panel goes through the page's confirm and says it went through (#36070's toast)", async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    fireEvent.click(button(container)!);
    const p = panel(container)!;
    await within(p).findByText(ADA_BODY);
    const own = Array.from(p.querySelectorAll('[data-comment-item]')).find((el) => el.textContent?.includes(ADA_BODY)) as HTMLElement;
    fireEvent.pointerDown(own.querySelector('[data-comment-action="more"]')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete' }));
    const dialog = await within(document.body).findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(within(panel(container)!).queryByText(ADA_BODY)).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Comment deleted');
  });

  it('no icon on an object with feeds off', async () => {
    const { container } = await mount({ objectName: NO_FEEDS });
    await act(async () => {});
    expect(button(container)).toBeNull();
  });

  it('no icon on a hand-written page, which keeps its own discussion block', async () => {
    // objectstack#36150 — the full page: an authored page is drawn there only.
    const { container } = await mount({ pages: [AUTHORED_PAGE] });
    expect(await within(container).findByText(ADA_BODY)).toBeInTheDocument();
    expect(button(container)).toBeNull();
    expect(panel(container)).toBeNull();
  });

  it('the drawer of an object with a hand-written page draws the standard page, so it offers the icon (objectstack#36150)', async () => {
    const { container } = await mount({ pages: [AUTHORED_PAGE], embedded: true });
    await waitFor(() => expect(button(container)).not.toBeNull());
    expect(panel(container)).toBeNull();
    fireEvent.click(button(container)!);
    expect(await within(panel(container)!).findByText(ADA_BODY)).toBeInTheDocument();
  });
});

/**
 * objectstack#36076 — the phone's comment page, through the REAL
 * `RecordDetailView` at 375 wide:
 *
 * - The icon is in the phone's top bar with the number of threads; a press
 *   pushes `?comments=` and draws the page over the record, which stays
 *   mounted under it.
 * - The list shows top-level comments only; a tap pushes the thread
 *   (`?comments=<id>`), which shows the comment and its reply. 「‹」 pops back
 *   to the list, then to the record, and the focus returns to the icon.
 * - A link or a reload straight to a thread: 「‹」 replaces the URL one level up.
 * - The 动态 tab keeps the system entries alone, as on the desktop.
 * - No icon on an object with feeds off.
 */
describe("the phone's comment page (objectstack#36076)", () => {
  beforeEach(() => setWindowWidth(375));

  const page = () => document.querySelector('[data-comments-page]') as HTMLElement | null;
  const search = () => document.querySelector('[data-testid="location"]')!.getAttribute('data-search');

  it('the top bar carries the icon with the thread count; a press pushes the page over the record', async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    expect(button(container)!.closest('[data-record-top-bar]')).not.toBeNull();
    await waitFor(() => expect(button(container)!.querySelector('[data-comments-count]')).toHaveTextContent('2'));
    expect(panel(container)).toBeNull();
    fireEvent.click(button(container)!);
    await waitFor(() => expect(page()).toHaveAttribute('data-comments-page', 'list'));
    expect(search()).toBe('?comments=');
    expect(document.querySelector('[data-testid="location"]')).toHaveAttribute('data-pushed', 'true');
    const list = within(page()!);
    expect(await list.findByText(ADA_BODY)).toBeInTheDocument();
    expect(list.getByText(GRACE_BODY)).toBeInTheDocument();
    expect(list.queryByText(REPLY_BODY)).toBeNull();
    expect(list.getByRole('button', { name: /1 reply/ })).toBeInTheDocument();
    // The record is still there, under the page.
    expect(within(container).getAllByText(`Case ${RECORD_ID}`).length).toBeGreaterThan(0);
  });

  it('a tap opens the thread; 「‹」 goes back to the list, then to the record, focus on the icon', async () => {
    const { container } = await mount();
    await waitFor(() => expect(button(container)).not.toBeNull());
    fireEvent.click(button(container)!);
    fireEvent.click(await within(page()!).findByText(ADA_BODY));
    await waitFor(() => expect(page()).toHaveAttribute('data-comments-page', 'thread'));
    expect(search()).toBe('?comments=c-ada');
    expect(within(page()!).getByText(REPLY_BODY)).toBeInTheDocument();
    fireEvent.click(page()!.querySelector('[data-comments-page-back]')!);
    await waitFor(() => expect(page()).toHaveAttribute('data-comments-page', 'list'));
    expect(search()).toBe('?comments=');
    fireEvent.click(page()!.querySelector('[data-comments-page-back]')!);
    await waitFor(() => expect(page()).toBeNull());
    expect(search()).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(button(container)));
  });

  it('a link straight to a thread: 「‹」 replaces the URL one level up', async () => {
    await mount({ search: '?comments=c-ada' });
    await waitFor(() => expect(page()).toHaveAttribute('data-comments-page', 'thread'));
    fireEvent.click(page()!.querySelector('[data-comments-page-back]')!);
    await waitFor(() => expect(page()).toHaveAttribute('data-comments-page', 'list'));
    expect(search()).toBe('?comments=');
    fireEvent.click(page()!.querySelector('[data-comments-page-back]')!);
    await waitFor(() => expect(page()).toBeNull());
    expect(search()).toBe('');
  });

  it('the 动态 tab keeps the system entries alone', async () => {
    const { container } = await mount({ search: '?tab=activity' });
    await waitFor(() => expect(button(container)).not.toBeNull());
    await act(async () => {});
    expect(within(container).queryByText(ADA_BODY)).toBeNull();
    expect(within(container).queryByText('Ctrl+Enter', { exact: false })).toBeNull();
  });

  it('no icon on an object with feeds off', async () => {
    const { container } = await mount({ objectName: NO_FEEDS });
    await act(async () => {});
    expect(button(container)).toBeNull();
  });
});

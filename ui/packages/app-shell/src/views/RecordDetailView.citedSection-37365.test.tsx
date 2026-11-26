// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37365 (ADR-0160 D9) — a record opened from an assistant citation
 * (`/apps/APP/OBJ/record/ID?section=ANCHOR`) opens at the cited section of its
 * body, through the REAL `RecordDetailView` and the real markdown face:
 *
 * - the heading the anchor names (the spec's `headingsOf`, as the server
 *   issued it) is scrolled to and marked, a repeated heading by its `-2`;
 * - a `textarea` body is scrolled to as a field, and nothing is marked;
 * - a stale anchor opens the record at its top: nothing scrolls, nothing is
 *   marked. CONTROL: the same record with a live anchor scrolls and marks;
 * - a setext `Scope` drawn above the cited `# Scope` (a same-titled heading the
 *   outline does not list) opens the field and marks nothing. CONTROL: the
 *   setext heading titled otherwise; the cited heading is marked;
 * - a second chip on the open record moves the mark (only the new section is
 *   marked), and the same chip clicked again (a fresh opened-state value)
 *   scrolls again. CONTROL: a navigation that keeps the state (a tab switch)
 *   does not scroll.
 * - objectstack#37487 (S5): a navigation that DROPS the state is no new click
 *   either: a state-dropping `replace` (how `useUrlOverlay` opens the command
 *   palette) and a pushed form overlay followed by Back leave the page where
 *   it is. CONTROL: a new string value after them scrolls again. The same
 *   holds when the overlay redraws the page from scratch (a remount without
 *   the state): the section is marked again and nothing scrolls.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

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

// The markdown face is lazily loaded by the cell renderer; importing it here
// moves its load into the import phase (ui/AGENTS.md, flaky-test discipline).
import '../../../fields/src/widgets/MarkdownContent';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { RecordDetailView } from './RecordDetailView';
import { RECORD_SECTION_TARGET_ATTR } from './recordSectionAnchor';
import { RECORD_SECTION_OPENED_STATE } from '../urlParams';

const OBJECT_NAME = 'policy';
const RECORD_ID = 'pol_7';

const BODY = ['# Intro', '', 'Hello.', '', '## Scope', '', 'Everyone.', '', '## Scope', '', 'Contractors too.'].join('\n');
const NOTES = ['# Steps', '', 'Sign the sheet.'].join('\n');
const SETEXT_BODY = ['Scope', '=====', '', 'Lead.', '', '# Scope', '', 'Everyone.'].join('\n');
const SETEXT_CONTROL = ['Preface', '=======', '', 'Lead.', '', '# Scope', '', 'Everyone.'].join('\n');

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  content: { type: 'markdown', label: 'Content' },
  notes: { type: 'textarea', label: 'Notes' },
};
const OBJECTS = [{ name: OBJECT_NAME, label: 'Policy', fields: FIELDS, enable: { feeds: false } }];

function makeDataSource(content = BODY) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, title: `Policy ${id}`, content, notes: NOTES })),
    create: vi.fn(async (_o: string, data: any) => ({ id: 'x', ...data })),
    update: vi.fn(async (_o: string, id: string, patch: any) => ({ id, ...patch })),
    delete: vi.fn(async () => true),
  } as any;
}

function metadata() {
  return {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'object' ? OBJECTS : []),
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
  objects: { [OBJECT_NAME]: FULL },
  fields: {},
} as MePermissionsAuthenticatedResponse;

let navigateTo: NavigateFunction | undefined;
const keepNavigate = (navigate: NavigateFunction) => {
  navigateTo = navigate;
};
function NavigateProbe({ onNavigate }: { onNavigate: (navigate: NavigateFunction) => void }) {
  const navigate = useNavigate();
  React.useEffect(() => onNavigate(navigate), [navigate, onNavigate]);
  return null;
}

/** Draws the page again from scratch whenever the query string changes, the way an overlay redraw can. */
function RemountOnSearch({ children }: { children: (key: string) => React.ReactElement }) {
  const { search } = useLocation();
  return children(search);
}

async function mount(search: string, content = BODY, opts: { remountOnSearch?: boolean } = {}) {
  const view = (key?: string) => (
    <RecordDetailView
      key={key}
      dataSource={makeDataSource(content)}
      objects={OBJECTS}
      onEdit={() => {}}
      objectNameOverride={OBJECT_NAME}
      recordIdOverride={RECORD_ID}
    />
  );
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={PERMS}>
        <MemoryRouter initialEntries={[`/apps/compliance/${OBJECT_NAME}/record/${RECORD_ID}${search}`]}>
          <NavigateProbe onNavigate={keepNavigate} />
          <MetadataCtx.Provider value={metadata()}>
            {opts.remountOnSearch ? <RemountOnSearch>{(key) => view(key)}</RemountOnSearch> : view()}
          </MetadataCtx.Provider>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  await within(rendered.container)
    .findAllByText(`Policy ${RECORD_ID}`, undefined, { timeout: 4000 })
    .catch(() => undefined);
  await act(async () => {});
  return rendered;
}

let scrolled: HTMLElement[] = [];
const originalScroll = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  scrolled = [];
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(async () => {
  cleanup();
  // The page forgets the section it opened once it has stayed unmounted (objectstack#37487 S5).
  await new Promise((resolve) => setTimeout(resolve, 0));
  HTMLElement.prototype.scrollIntoView = originalScroll;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const marked = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(`[${RECORD_SECTION_TARGET_ATTR}]`));
const headingsNamed = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-detail-field="content"] h2')).filter((h) => h.textContent === text);

describe('a record opened at a cited section (objectstack#37365)', () => {
  it('scrolls to the heading the anchor names and marks it', async () => {
    const { container } = await mount('?section=scope');
    await waitFor(() => expect(marked(container)).toHaveLength(1), { timeout: 4000 });
    const [first] = headingsNamed(container, 'Scope');
    expect(marked(container)[0]).toBe(first);
    expect(scrolled).toEqual([first]);
  });

  it('a repeated heading is told apart by its `-2`', async () => {
    const { container } = await mount('?section=scope-2');
    await waitFor(() => expect(marked(container)).toHaveLength(1), { timeout: 4000 });
    const [, second] = headingsNamed(container, 'Scope');
    expect(marked(container)[0]).toBe(second);
    expect(scrolled).toEqual([second]);
  });

  it('a `textarea` body scrolls to the field, and marks nothing', async () => {
    const { container } = await mount('?section=steps');
    await waitFor(() => expect(scrolled).toHaveLength(1), { timeout: 4000 });
    expect(scrolled[0].getAttribute('data-detail-field')).toBe('notes');
    expect(marked(container)).toHaveLength(0);
  });

  it('a stale anchor opens the record at its top; CONTROL: a live anchor on the same record scrolls and marks', async () => {
    const stale = await mount('?section=renamed-heading');
    await waitFor(() => expect(headingsNamed(stale.container, 'Scope')).toHaveLength(2), { timeout: 4000 });
    await act(async () => {});
    expect(scrolled).toEqual([]);
    expect(marked(stale.container)).toHaveLength(0);
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const live = await mount('?section=intro');
    await waitFor(() => expect(marked(live.container)).toHaveLength(1), { timeout: 4000 });
    expect(marked(live.container)[0].textContent).toBe('Intro');
    expect(scrolled).toHaveLength(1);
  });

  it('a same-titled heading the outline does not list opens the field, never that heading; CONTROL: titled otherwise, the cited heading is marked', async () => {
    const dup = await mount('?section=scope', SETEXT_BODY);
    const field = () => dup.container.querySelector<HTMLElement>('[data-detail-field="content"]');
    await waitFor(() => expect(field()?.querySelectorAll('h1')).toHaveLength(2), { timeout: 4000 });
    // Both drawn headings read `Scope`; the outline lists one. Nothing is
    // marked, and once the settle (RECORD_SECTION_SETTLE_MS) passes the field
    // is scrolled to.
    expect(marked(dup.container)).toHaveLength(0);
    await waitFor(() => expect(scrolled).toEqual([field()]), { timeout: 7000 });
    expect(marked(dup.container)).toHaveLength(0);
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrolled = [];
    const control = await mount('?section=scope', SETEXT_CONTROL);
    await waitFor(() => expect(marked(control.container)).toHaveLength(1), { timeout: 4000 });
    expect(marked(control.container)[0].textContent).toBe('Scope');
    expect(marked(control.container)[0].tagName).toBe('H1');
    expect(scrolled).toEqual([marked(control.container)[0]]);
  }, 20000);

  it('a second chip moves the mark, and the same chip clicked again scrolls again; CONTROL: a navigation keeping the state does not', async () => {
    const { container } = await mount('?section=scope');
    await waitFor(() => expect(marked(container)).toHaveLength(1), { timeout: 4000 });
    const [first, second] = headingsNamed(container, 'Scope');
    const path = `/apps/compliance/${OBJECT_NAME}/record/${RECORD_ID}`;
    // A second chip on the open record: only its section is marked.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-2' } });
    });
    await waitFor(() => expect(marked(container)).toEqual([second]), { timeout: 4000 });
    expect(first.hasAttribute(RECORD_SECTION_TARGET_ATTR)).toBe(false);
    expect(scrolled).toEqual([first, second]);
    // The same chip again: same URL, a fresh state value.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-3' } });
    });
    await waitFor(() => expect(scrolled).toEqual([first, second, second]), { timeout: 4000 });
    expect(marked(container)).toEqual([second]);
    // CONTROL: a replace that keeps the state (how a tab switch writes the URL).
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { replace: true, state: { [RECORD_SECTION_OPENED_STATE]: 'click-3' } });
    });
    await act(async () => {});
    expect(scrolled).toEqual([first, second, second]);
    expect(marked(container)).toEqual([second]);
  });

  it('a navigation dropping the state does not scroll back (objectstack#37487 S5); CONTROL: a new click after it does', async () => {
    const { container } = await mount('?section=scope');
    await waitFor(() => expect(marked(container)).toHaveLength(1), { timeout: 4000 });
    const [first, second] = headingsNamed(container, 'Scope');
    const path = `/apps/compliance/${OBJECT_NAME}/record/${RECORD_ID}`;
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-1' } });
    });
    await waitFor(() => expect(scrolled).toEqual([first, second]), { timeout: 4000 });
    // A state-dropping replace: an overlay param written over the URL with no state.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2&palette=1`, { replace: true });
    });
    await act(async () => {});
    expect(scrolled).toEqual([first, second]);
    // A pushed overlay (no state), then Back to the entry the click wrote.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2&form=edit`);
    });
    await act(async () => {});
    await act(async () => {
      navigateTo!(-1);
    });
    await act(async () => {});
    expect(scrolled).toEqual([first, second]);
    expect(marked(container)).toEqual([second]);
    // CONTROL: a new click after them still opens the section.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-2' } });
    });
    await waitFor(() => expect(scrolled).toEqual([first, second, second]), { timeout: 4000 });
  });

  it('a remount by a pushed overlay, and Back, marks the section again and does not scroll (objectstack#37487 S5); CONTROL: a new click scrolls', async () => {
    const { container } = await mount('?section=scope', BODY, { remountOnSearch: true });
    await waitFor(() => expect(marked(container)).toHaveLength(1), { timeout: 4000 });
    const path = `/apps/compliance/${OBJECT_NAME}/record/${RECORD_ID}`;
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-1' } });
    });
    await waitFor(() => expect(scrolled).toHaveLength(2), { timeout: 4000 });
    // The pushed form redraws the page from scratch, without the click's state.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2&form=edit`);
    });
    const second = () => headingsNamed(container, 'Scope')[1];
    await waitFor(() => expect(marked(container)).toEqual([second()]), { timeout: 4000 });
    await act(async () => {
      navigateTo!(-1);
    });
    await waitFor(() => expect(marked(container)).toEqual([second()]), { timeout: 4000 });
    expect(scrolled).toHaveLength(2);
    // CONTROL: a new click after them scrolls.
    await act(async () => {
      navigateTo!(`${path}?section=scope-2`, { state: { [RECORD_SECTION_OPENED_STATE]: 'click-2' } });
    });
    await waitFor(() => expect(scrolled).toHaveLength(3), { timeout: 4000 });
  });
});

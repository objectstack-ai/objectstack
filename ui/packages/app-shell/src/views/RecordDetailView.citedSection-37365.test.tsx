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
 *   marked. CONTROL: the same record with a live anchor scrolls and marks.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within, act, waitFor } from '@testing-library/react';
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

// The markdown face is lazily loaded by the cell renderer; importing it here
// moves its load into the import phase (ui/AGENTS.md, flaky-test discipline).
import '../../../fields/src/widgets/MarkdownContent';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { RecordDetailView } from './RecordDetailView';
import { RECORD_SECTION_TARGET_ATTR } from './recordSectionAnchor';

const OBJECT_NAME = 'policy';
const RECORD_ID = 'pol_7';

const BODY = ['# Intro', '', 'Hello.', '', '## Scope', '', 'Everyone.', '', '## Scope', '', 'Contractors too.'].join('\n');
const NOTES = ['# Steps', '', 'Sign the sheet.'].join('\n');

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  content: { type: 'markdown', label: 'Content' },
  notes: { type: 'textarea', label: 'Notes' },
};
const OBJECTS = [{ name: OBJECT_NAME, label: 'Policy', fields: FIELDS, enable: { feeds: false } }];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, title: `Policy ${id}`, content: BODY, notes: NOTES })),
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

async function mount(search: string) {
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={PERMS}>
        <MemoryRouter initialEntries={[`/apps/compliance/${OBJECT_NAME}/record/${RECORD_ID}${search}`]}>
          <MetadataCtx.Provider value={metadata()}>
            <RecordDetailView
              dataSource={makeDataSource()}
              objects={OBJECTS}
              onEdit={() => {}}
              objectNameOverride={OBJECT_NAME}
              recordIdOverride={RECORD_ID}
            />
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

afterEach(() => {
  cleanup();
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
    const live = await mount('?section=intro');
    await waitFor(() => expect(marked(live.container)).toHaveLength(1), { timeout: 4000 });
    expect(marked(live.container)[0].textContent).toBe('Intro');
    expect(scrolled).toHaveLength(1);
  });
});

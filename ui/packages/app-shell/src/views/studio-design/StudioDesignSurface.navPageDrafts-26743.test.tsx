// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#26743 — the Interfaces nav editor's target picker
 * offers a draft-only page only when its draft body can be a nav target.
 *
 * A `page` nav entry opens a static page URL with no record id, so a record
 * page is never a valid target (`isStaticPageOption`). The picker filtered the
 * published rows by the body's `type`, but added every draft-only row
 * unfiltered: a `_drafts` header names the metadata type (`page`), not the
 * body's `type`. A draft record page was offered, and picking it gave a dead
 * entry once the app was published. The picker now reads a draft-only row's
 * draft body and judges it as it judges a published row:
 *
 *  - a draft record page is not offered;
 *  - a draft static page is offered;
 *  - a published record page is still not offered;
 *  - a draft action bound to an object is not offered (the nav runs global
 *    actions only), a draft global action is;
 *  - CONTROL: a draft whose body cannot be read is still offered, as a row
 *    with no `type` is.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

const PKG = 'com.acme.app';

/** Published pages, as `client.list('page')` serves them: bodies, with `type`. */
const PUBLISHED_PAGES = [
  { name: 'ops_home', label: 'Ops home', type: 'app' },
  { name: 'ticket_detail', label: 'Ticket detail', type: 'record' },
];

/** Draft bodies the `?state=draft` read serves, keyed `type:name`. */
const DRAFT_BODIES: Record<string, Record<string, unknown> | undefined> = {
  'page:case_record': { name: 'case_record', label: 'Case record', type: 'record' },
  'page:case_board': { name: 'case_board', label: 'Case board', type: 'list' },
  'action:close_case': { name: 'close_case', label: 'Close case', objectName: 'repairs_case' },
  'action:open_inbox': { name: 'open_inbox', label: 'Open inbox' },
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<unknown[]> => []),
  // The `_drafts` headers: metadata type and name, never the body's `type`.
  listDrafts: vi.fn(async (options?: { packageId?: string; type?: string }): Promise<unknown[]> => {
    if (options?.type === 'page') {
      return [
        { type: 'page', name: 'case_record', packageId: 'com.acme.app', label: 'Case record' },
        { type: 'page', name: 'case_board', packageId: 'com.acme.app', label: 'Case board' },
        { type: 'page', name: 'case_unread', packageId: 'com.acme.app', label: 'Case unread' },
      ];
    }
    if (options?.type === 'action') {
      return [
        { type: 'action', name: 'close_case', packageId: 'com.acme.app', label: 'Close case' },
        { type: 'action', name: 'open_inbox', packageId: 'com.acme.app', label: 'Open inbox' },
      ];
    }
    return [];
  }),
  getDraft: vi.fn(async (): Promise<unknown> => null),
  get: vi.fn(async () => undefined),
  withPreviewDrafts: vi.fn((): unknown => mockClient),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioNavItemInspector } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const METADATA = {
  apps: [],
  objects: [],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type?: unknown) => (type === 'page' ? PUBLISHED_PAGES : []));
  mockClient.getDraft.mockImplementation(async (type?: unknown, name?: unknown) => {
    if (name === 'case_unread') throw new Error('draft read failed');
    const body = DRAFT_BODIES[`${String(type)}:${String(name)}`];
    // The served envelope, decorated as the framework serves it.
    return body ? { type, name, item: { ...body, _draft: true } } : null;
  });
});

afterEach(() => {
  cleanup();
});

async function openPicker(navigation: unknown[], name: string) {
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <StudioNavItemInspector
        navId="navigation[0]"
        appDraft={{ navigation }}
        objects={[]}
        packageId={PKG}
        onNavPatch={vi.fn()}
        onClear={vi.fn()}
      />
    </MetadataCtx.Provider>,
  );
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

describe('objectstack-ai/objectstack#26743 — the nav page picker judges a draft-only page on its draft body', () => {
  it('a draft record page is not offered', async () => {
    const listbox = await openPicker([{ id: 'nav_page', type: 'page' }], 'Page');
    // Wait for the draft static page, read in the same pass, before asserting an absence.
    await within(listbox).findByRole('option', { name: 'Case board (case_board)' });
    expect(within(listbox).queryByRole('option', { name: /case_record/ })).toBeNull();
  });

  it('a draft static page is offered', async () => {
    const listbox = await openPicker([{ id: 'nav_page', type: 'page' }], 'Page');
    expect(await within(listbox).findByRole('option', { name: 'Case board (case_board)' })).toBeInTheDocument();
  });

  it('a published record page is still not offered, a published static page is', async () => {
    const listbox = await openPicker([{ id: 'nav_page', type: 'page' }], 'Page');
    expect(await within(listbox).findByRole('option', { name: 'Ops home (ops_home)' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /ticket_detail/ })).toBeNull();
  });

  it('CONTROL: a draft whose body cannot be read is still offered', async () => {
    const listbox = await openPicker([{ id: 'nav_page', type: 'page' }], 'Page');
    expect(await within(listbox).findByRole('option', { name: 'Case unread (case_unread)' })).toBeInTheDocument();
  });

  it('a draft action bound to an object is not offered, a draft global action is', async () => {
    const listbox = await openPicker([{ id: 'nav_action', type: 'action' }], 'Action');
    expect(await within(listbox).findByRole('option', { name: 'Open inbox (open_inbox)' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /close_case/ })).toBeNull();
  });

  it('a draft body is read only for a type whose verdict reads the body', async () => {
    await openPicker([{ id: 'nav_page', type: 'page' }], 'Page');
    await screen.findByRole('option', { name: 'Case board (case_board)' });
    expect(mockClient.getDraft).toHaveBeenCalledWith('page', 'case_record', { packageId: PKG });
    // A published row is never re-read as a draft.
    expect(mockClient.getDraft).not.toHaveBeenCalledWith('page', 'ops_home', expect.anything());
  });
});

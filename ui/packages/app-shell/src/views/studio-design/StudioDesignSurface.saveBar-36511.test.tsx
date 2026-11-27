// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the Studio surface's Cancel and Save, Changes and
 * Publish only for drafts. objectstack#37455 — Cancel and Save moved from the
 * top bar to the page's item header, behaviour unchanged.
 *
 * - With no draft pending, 概览's menu row carries no count.
 * - An edit on the object page draws Cancel and Save at the end of the item
 *   header's actions, and nowhere else (objectstack#37456: Studio has no top
 *   bar); Save is the last action, and only the assistant (behind its
 *   hairline) follows it.
 * - With a draft pending (the copilot's), 概览's row counts it (its Pending tab
 *   holds Changes and Publish, objectstack#37454), and a publish is refused
 *   while the page holds edits Save has not sent: the publish re-reads the
 *   page and would drop them.
 *
 * Real: the surface, the Data pillar, the coordinator and `usePendingDrafts`.
 * Doubles: the metadata client's reads and transport, the `_drafts` ledger
 * read, the package list, and the panels no assertion reads (the changes
 * sheet is a button that runs its `onPublish`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PACKAGE_ID = 'app.a';
const objectDef = { name: 'a_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const writes: string[] = [];
const transport = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (method === 'GET') return json(404, null);
  writes.push(`${method} ${url}`);
  return json(200, { success: true });
});
const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: transport as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'a_task', label: 'Task' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
});

const ledger: { drafts: Array<Record<string, unknown>> } = { drafts: [] };

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [] }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'a' }]),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return { ...actual, useAdapter: () => dataSource };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (p: { onPublish?: () => void }) =>
    p.onPublish ? (
      <button type="button" data-testid="sheet-publish-all" onClick={() => p.onPublish?.()}>
        publish all
      </button>
    ) : null,
}));

import { toast } from 'sonner';
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (url.includes('/meta/_drafts')) return json(200, { drafts: ledger.drafts });
      if (init?.method && init.method !== 'GET') writes.push(`${init.method} ${url}`);
      return json(200, []);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  writes.length = 0;
  ledger.drafts = [];
  vi.mocked(toast.error).mockClear();
});

async function mountAndEdit(): Promise<{ topLeft: HTMLElement; itemHeader: HTMLElement }> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/metadata/object/a_task`]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Field layout' }, { timeout: 4000 }));
  await addFieldFromFormToolbar(undefined, { label: 'Due' });
  return { topLeft: screen.getByTestId('studio-top-left'), itemHeader: screen.getByTestId('data-object-header') };
}

/** The item header's action slot: the right-aligned box of its title row. */
const actionSlot = (save: HTMLElement): HTMLElement => save.parentElement as HTMLElement;

describe('the Studio page\'s Save and Cancel, Changes and Publish for drafts (objectstack#36511, objectstack#37455)', () => {
  it('with no draft pending: no count; an edit draws Cancel and Save at the end of the item header, and only there', async () => {
    const { topLeft, itemHeader } = await mountAndEdit();
    const save = await within(itemHeader).findByTestId('studio-save');
    const cancel = within(itemHeader).getByTestId('studio-cancel');
    // objectstack#37455, objectstack#37456 — one Save, one Cancel, none in the left column.
    expect(within(topLeft).queryByTestId('studio-save')).toBeNull();
    expect(within(topLeft).queryByTestId('studio-cancel')).toBeNull();
    expect(screen.getAllByTestId('studio-save')).toHaveLength(1);
    expect(screen.getAllByTestId('studio-cancel')).toHaveLength(1);
    expect(screen.queryByTestId('studio-menu-overview-pending')).toBeNull();
    // Cancel, then Save: the last of the item header's actions; only the
    // assistant follows it, behind the hairline.
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const actions = within(actionSlot(save))
      .getAllByRole('button')
      .filter((b) => !['studio-slot-toggle', 'topbar-ai-assistant'].includes(b.getAttribute('data-testid') ?? ''));
    expect(actions[actions.length - 1]).toBe(save);
    expect(writes).toEqual([]);
  });

  it('with a draft pending: 概览 counts it, Cancel and Save in the item header; Publish waits for Save', async () => {
    ledger.drafts = [{ type: 'flow', name: 'a_notify', packageId: PACKAGE_ID }];
    const { topLeft, itemHeader } = await mountAndEdit();
    await waitFor(() => expect(screen.getByTestId('studio-menu-overview-pending')).toHaveTextContent('1'), { timeout: 4000 });
    const cancel = await within(itemHeader).findByTestId('studio-cancel');
    const save = within(itemHeader).getByTestId('studio-save');
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(topLeft).queryByTestId('studio-save')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-publish-all'));
    });
    expect(toast.error).toHaveBeenCalledWith(t('engine.studio.save.publishFirst', 'en'));
    expect(writes.filter((w) => w.includes('publish'))).toEqual([]);
    await waitFor(() => expect(within(itemHeader).getByTestId('studio-save')).toBeInTheDocument());
  });
});

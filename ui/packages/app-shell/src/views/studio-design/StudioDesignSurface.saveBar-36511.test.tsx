// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the top bar of the Studio surface: Cancel and Save
 * where Publish was, Changes and Publish only for drafts.
 *
 * - With no draft pending, the top bar draws neither Changes nor Publish.
 * - An edit on the object page draws Cancel and Save in the top bar's right
 *   column; Save is its last action.
 * - With a draft pending (the copilot's), Changes and Publish are drawn, at the
 *   left of Cancel and Save, and a publish is refused while the page holds
 *   edits Save has not sent: the publish re-reads the page and would drop them.
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
import { StudioDesignSurface } from './StudioDesignSurface';
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

const CHANGES = new RegExp(`^${t('engine.studio.changes', 'en')}`);
const PUBLISH = new RegExp(`^${t('engine.studio.publish', 'en')}$`);

async function mountAndEdit(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }, { timeout: 4000 }));
  await addFieldFromFormToolbar(undefined, { label: 'Due' });
  return screen.getByTestId('studio-shell-header');
}

describe('the Studio top bar: Save where Publish was, Changes and Publish for drafts (objectstack#36511)', () => {
  it('with no draft pending: no Changes, no Publish; an edit draws Cancel and Save at the right', async () => {
    const header = await mountAndEdit();
    const save = await within(header).findByTestId('studio-save');
    const cancel = within(header).getByTestId('studio-cancel');
    expect(within(header).queryByRole('button', { name: CHANGES })).toBeNull();
    expect(within(header).queryByRole('button', { name: PUBLISH })).toBeNull();
    // Cancel, then Save: the last of the right column's actions, where Publish
    // was; only the slot's show/hide icon follows it, as it followed Publish.
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const column = save.parentElement as HTMLElement;
    const actions = within(column)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-testid') !== 'studio-slot-toggle');
    expect(actions[actions.length - 1]).toBe(save);
    expect(writes).toEqual([]);
  });

  it('with a draft pending: Changes and Publish at the left of Cancel and Save; Publish waits for Save', async () => {
    ledger.drafts = [{ type: 'flow', name: 'a_notify', packageId: PACKAGE_ID }];
    const header = await mountAndEdit();
    const changes = await within(header).findByRole('button', { name: CHANGES }, { timeout: 4000 });
    const publish = within(header).getByRole('button', { name: PUBLISH });
    const cancel = await within(header).findByTestId('studio-cancel');
    const save = within(header).getByTestId('studio-save');
    expect(changes.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(publish.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-publish-all'));
    });
    expect(toast.error).toHaveBeenCalledWith(t('engine.studio.save.publishFirst', 'en'));
    expect(writes.filter((w) => w.includes('publish'))).toEqual([]);
    await waitFor(() => expect(within(header).getByTestId('studio-save')).toBeInTheDocument());
  });
});

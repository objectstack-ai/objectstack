// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725, phase 5 (Target item 5) — the item header shows
 * 「草稿 · N 项未发布」 while the open item has a pending draft, and N is the
 * number the 变更 badge shows.
 *
 * The case the line exists for: the copilot writes a draft to the object the
 * author has open. The Data pillar read that object when it opened it (no
 * draft then), and does not re-read it on the copilot's pulse; the ledger the
 * badge counts does. So the line follows the ledger: it shows as the draft
 * lands, and goes when a publish or a discard takes the item off the ledger.
 *
 * Real: the surface, its top bar, `usePendingDrafts`, the Data pillar and its
 * header. Stubbed: the metadata client (the object, no draft of its own),
 * `globalThis.fetch` (the `_drafts` ledger), the copilot (its side — the pulse
 * as a drafted result lands — is pinned in
 * `StudioDesignSurface.copilotDraftBadge-12725.test.tsx`; here the pulse is
 * sent as `ChatPane` sends it), and the Changes panel, reduced to the button
 * that runs the surface's own publish.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.acme.app';
const DRAFTS = `/api/v1/meta/_drafts?packageId=${encodeURIComponent(PACKAGE_ID)}`;
const OBJECT = {
  name: 'acme_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

/** What `_drafts` answers: the package's pending drafts, server-side. */
const server = vi.hoisted(() => ({ drafts: [] as Array<Record<string, unknown>> }));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) =>
    type === 'app'
      ? [{ name: 'acme_app', label: 'Acme' }]
      : type === 'object'
        ? [{ name: OBJECT.name, label: OBJECT.label }]
        : [],
  ),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: [] } };
    if (type === 'object') return { effective: OBJECT, code: OBJECT };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  publishPackageDrafts: vi.fn(async () => {
    const published = server.drafts.map((d) => ({ type: d.type, name: d.name }));
    server.drafts = [];
    return { success: true, published };
  }),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => dataSource };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: ({ onPublish }: { onPublish?: () => void | Promise<void> }) => (
    <button type="button" data-testid="changes-panel-publish" onClick={() => void onPublish?.()}>
      publish all
    </button>
  ),
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';
import { emitMetadataRefresh } from '../../assistant/assistantBus';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  server.drafts = [];
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/packages') {
        return answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } });
      }
      if (url === DRAFTS) return answer({ drafts: server.drafts });
      return answer([]);
    }),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const SLOW = { timeout: 4000 };
const header = () => screen.getByTestId('data-object-header');
const headerStatus = () => within(header()).queryByTestId('studio-item-status');
const draftLine = (count: number) => tFormat('engine.studio.itemDraftPending', 'en', { count });

/** The copilot's draft rows: the open object, and a view of it. */
const COPILOT_DRAFTS = [
  { type: 'object', name: OBJECT.name, label: 'Task', packageId: PACKAGE_ID, updatedAt: null, updatedBy: 'u1' },
  { type: 'view', name: `${OBJECT.name}.board`, label: 'Board', packageId: PACKAGE_ID, updatedAt: null, updatedBy: 'u1' },
];

/** Open the Data pillar on the Task object, with an empty ledger. */
async function openTask() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Task/ }, SLOW));
  await waitFor(() => expect(within(header()).getByText('Task')).toBeInTheDocument(), SLOW);
  expect(headerStatus()).toBeNull();
  expect(screen.queryByTestId('studio-changes-count')).toBeNull();
}

/** The copilot's tool wrote drafts server-side, and its result landed. */
async function copilotDrafts(rows: Array<Record<string, unknown>>) {
  server.drafts = rows;
  await act(async () => {
    emitMetadataRefresh();
  });
}

describe('the item header\'s draft line follows the badge\'s ledger (objectui#12725)', () => {
  it('shows 「草稿 · N 项未发布」 on the open object as the copilot\'s draft lands, N the badge\'s number', async () => {
    await openTask();
    await copilotDrafts(COPILOT_DRAFTS);

    await waitFor(() => expect(headerStatus()).toHaveTextContent(draftLine(2)));
    expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('2');
    // The longer sentence says what N counts.
    expect(headerStatus()).toHaveAccessibleDescription(tFormat('engine.studio.itemDraftPendingTitle', 'en', { count: 2 }));
    // The pillar's own reading of the object was never asked again.
    expect(screen.queryByText(t('engine.studio.unpublishedDraft', 'en'))).toBeNull();
  });

  it('is gone after a publish', async () => {
    await openTask();
    await copilotDrafts(COPILOT_DRAFTS);
    await waitFor(() => expect(headerStatus()).toHaveTextContent(draftLine(2)));

    await act(async () => {
      fireEvent.click(screen.getByTestId('changes-panel-publish'));
    });

    expect(mockClient.publishPackageDrafts).toHaveBeenCalledWith(PACKAGE_ID);
    await waitFor(() => expect(headerStatus()).toBeNull());
    expect(screen.queryByTestId('studio-changes-count')).toBeNull();
  });

  it('is gone after a discard takes the item off the ledger', async () => {
    await openTask();
    await copilotDrafts(COPILOT_DRAFTS);
    await waitFor(() => expect(headerStatus()).toHaveTextContent(draftLine(2)));

    // The object's draft is discarded (the view's stays), and the discarding
    // door announces it.
    await copilotDrafts(COPILOT_DRAFTS.slice(1));

    await waitFor(() => expect(headerStatus()).toBeNull());
    expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1');
  });

  it('CONTROL: a draft of another item is counted by the badge and marks no header', async () => {
    await openTask();
    await copilotDrafts([
      { type: 'object', name: 'acme_project', label: 'Project', packageId: PACKAGE_ID, updatedAt: null, updatedBy: 'u1' },
    ]);

    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1'));
    expect(headerStatus()).toBeNull();
  });
});

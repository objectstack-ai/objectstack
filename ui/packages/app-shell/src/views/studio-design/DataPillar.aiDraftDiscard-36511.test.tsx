// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 item 6 — an object the AI assistant left an unpublished
 * draft on.
 *
 * - The page opens on the draft (the AI's version), and the line over the
 *   canvas says 「这一项有 AI 未发布的改动，保存会一并生效」.
 * - 「放弃 AI 的改动」 discards that one object's draft at its package
 *   (`DELETE /meta/object/NAME?state=draft&package=`), never the package's
 *   batch discard; the page goes back to the live version, the line goes, and
 *   the ledger behind Changes is told to count again (the metadata pulse), so
 *   its count drops by that item. It never reports a draft save
 *   (`onDraftSaved`), which would hold the count at one or more.
 * - Unsaved edits on the page go with the discard, so the author is asked
 *   first; declined, nothing is sent.
 * - CONTROL: a draft a person wrote in Studio draws neither the notice nor the
 *   button.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PACKAGE = 'com.example.showcase';
const live = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    priority: { name: 'priority', label: 'Priority', type: 'text' },
  },
};
/** The AI's version: one field added. */
const aiVersion = {
  ...live,
  fields: { ...live.fields, renewal_count: { name: 'renewal_count', label: 'Renewals', type: 'number' } },
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000 - 5_000).toISOString();

/** What the next draft read serves: `null` for no draft. */
let draftEnvelope: Record<string, unknown> | null = null;

const mockClient = {
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({})),
  reset: vi.fn(async () => {
    draftEnvelope = null;
    return {};
  }),
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_task', label: 'Task' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: live, code: live, draft: draftEnvelope?.item ?? null })),
  getDraft: vi.fn(async () => draftEnvelope),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import '@objectstack/lint';
import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { StudioSaveHarness } from './__tests__/studioSaveHarness';
import { t } from '../metadata-admin/i18n';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus';

const discardDrafts = vi.fn(async () => ({ success: true, failedCount: 0, failed: [], discarded: [] }));
const dataSource = Object.assign(createEmptyDataSource(), {
  getClient: () => ({ packages: { discardDrafts } }),
});
failOnAbsorbedFetchError();

const L = (key: string) => t(key, 'en-US');

const confirmSpy = vi.fn((_message?: string) => true);
beforeEach(() => {
  draftEnvelope = null;
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function serveDraft(by: string) {
  draftEnvelope = {
    type: 'object',
    name: 'showcase_task',
    item: { ...aiVersion, _draft: true },
    version: 'v1',
    draftChanges: [{ path: ['fields', 'renewal_count'], by, actor: 'usr_1', at: minutesAgo(2) }],
  };
}

function renderPillar(onDraftSaved = vi.fn()): { onDraftSaved: ReturnType<typeof vi.fn> } {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE}/data`]}>
      <StudioSaveHarness locale="en-US">
        <DataPillar objectName="showcase_task" packageId={PACKAGE} onDraftSaved={onDraftSaved} />
      </StudioSaveHarness>
    </MemoryRouter>,
  );
  return { onDraftSaved };
}

/** The Form canvas's card of the field labelled `label`, or `null`. */
const card = (label: string) =>
  screen.queryAllByText(label).map((el) => el.closest('.cursor-grab')).find((el) => el !== null) ?? null;

async function openForm(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: L('engine.studio.data.tab.form') }));
  await screen.findByTestId('form-toolbar');
}

describe('an object with the AI assistant’s unpublished changes (objectstack#36511 item 6)', () => {
  it('the page shows the AI’s version and says Save makes it live too', async () => {
    serveDraft('copilot');
    renderPillar();
    const line = await screen.findByTestId('studio-copilot-changes');
    expect(within(line).getByTestId('studio-ai-draft-notice')).toHaveTextContent(L('engine.studio.aiDraft.notice'));
    expect(within(line).getByTestId('studio-ai-draft-discard')).toHaveTextContent(L('engine.studio.aiDraft.discard'));
    await openForm();
    await waitFor(() => expect(card('Renewals')).not.toBeNull());
  });

  it('放弃 AI 的改动 discards this object’s draft only, goes back to the live version, and the ledger is told', async () => {
    serveDraft('copilot');
    const { onDraftSaved } = renderPillar();
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    await openForm();
    await waitFor(() => expect(card('Renewals')).not.toBeNull());

    fireEvent.click(await screen.findByTestId('studio-ai-draft-discard'));
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(1));
    expect(mockClient.reset).toHaveBeenCalledWith('object', 'showcase_task', { state: 'draft', packageId: PACKAGE });
    expect(discardDrafts, 'never the package’s batch discard').not.toHaveBeenCalled();
    expect(confirmSpy, 'no unsaved edit, nothing to ask').not.toHaveBeenCalled();

    await waitFor(() => expect(card('Renewals')).toBeNull());
    expect(card('Priority')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('studio-copilot-changes')).toBeNull());
    expect(pulses, 'the ledger is told to count again').toBeGreaterThan(0);
    expect(onDraftSaved, 'no draft was saved').not.toHaveBeenCalled();
    expect(mockClient.save, 'a discard writes nothing').not.toHaveBeenCalled();
    expect(mockClient.publish).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('with an unsaved edit on the page, the author is asked first; declined, nothing is sent', async () => {
    serveDraft('mcp');
    renderPillar();
    await openForm();
    await addFieldFromFormToolbar(undefined, { label: 'Due' });
    await screen.findByTestId('studio-save');

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledWith(L('engine.studio.aiDraft.discardConfirmUnsaved'));
    expect(mockClient.reset).not.toHaveBeenCalled();
    expect(card('Due'), 'the edit stays').not.toBeNull();

    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(card('Due')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
  });

  it('CONTROL: a draft a person wrote in Studio draws neither the notice nor the button', async () => {
    serveDraft('studio');
    renderPillar();
    await openForm();
    await waitFor(() => expect(mockClient.getDraft).toHaveBeenCalled());
    await waitFor(() => expect(card('Renewals')).not.toBeNull());
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
    expect(screen.queryByTestId('studio-ai-draft-discard')).toBeNull();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34725 item 7 — the AI assistant's drafts on the Data canvas:
 *  - a line over the canvas, 「AI 刚改了 N 处」, counting the pending draft's
 *    `draftChanges` entries an AI tool wrote (copilot or MCP), with 查看 (the
 *    pending-changes sheet) and 放弃全部未发布改动 (the package's discard door,
 *    `packages.discardDrafts`, after a confirm) — the one undo there is;
 *  - the Form canvas's card of each field the assistant changed carries the
 *    草稿 chip;
 *  - item 6: the copilot's chip names the open object by its label and the view
 *    on screen (`Task · Records`), never its internal name.
 * CONTROL: entries a person wrote in Studio, or no draft, draw no line.
 *
 * The records grid's column marks ride on `GridFieldAuthoring.columnMarks`,
 * pinned in `@object-ui/components` (`data-table-columnMarks-34725`): a
 * field the assistant added is a draft, and the grid selects published fields
 * only (cloud#1652), so a new field has no column until it is published.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    priority: { name: 'priority', label: 'Priority', type: 'text' },
    renewal_count: { name: 'renewal_count', label: 'Renewals', type: 'number' },
  },
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000 - 5_000).toISOString();

/** What the next draft read serves: `null` for no draft. */
let draftEnvelope: Record<string, unknown> | null = null;

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_task', label: 'Task' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef, draft: draftEnvelope?.item ?? null })),
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
import { t, tFormat } from '../metadata-admin/i18n';

const discardDrafts = vi.fn(async () => ({ success: true, failedCount: 0, failed: [], discarded: [] }));
const dataSource = Object.assign(createEmptyDataSource(), {
  getClient: () => ({ packages: { discardDrafts } }),
});
failOnAbsorbedFetchError();

beforeEach(() => {
  draftEnvelope = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const L = (key: string) => t(key, 'en-US');

function serveDraft(draftChanges?: unknown[]) {
  draftEnvelope = {
    type: 'object',
    name: 'showcase_task',
    item: { ...objectDef, _draft: true },
    version: 'v1',
    ...(draftChanges ? { draftChanges } : {}),
  };
}

function renderPillar(props: Partial<React.ComponentProps<typeof DataPillar>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" {...props} />
    </MemoryRouter>,
  );
}

const AI_TWO = [
  { path: [], by: 'studio', actor: 'usr_1', at: minutesAgo(30) },
  { path: ['fields', 'renewal_count'], by: 'copilot', actor: 'usr_1', at: minutesAgo(2) },
  { path: ['fields', 'priority', 'label'], by: 'mcp', client: 'Claude Desktop', actor: 'usr_1', at: minutesAgo(1) },
];

describe('the AI assistant’s drafts on the Data canvas (objectstack#34725)', () => {
  it('a line counts the AI entries; 查看 opens the review; the AI-changed field cards carry the chip', async () => {
    serveDraft(AI_TWO);
    const onReviewChanges = vi.fn();
    renderPillar({ onReviewChanges });
    const line = await screen.findByTestId('studio-copilot-changes');
    expect(line).toHaveTextContent(tFormat('engine.studio.copilotChanges.line', 'en-US', { count: 2 }));
    fireEvent.click(within(line).getByTestId('studio-copilot-changes-view'));
    expect(onReviewChanges).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.data.tab.form') }));
    await waitFor(() => expect(screen.getAllByTestId('studio-form-field-draft-chip')).toHaveLength(2));
    expect(
      screen.getAllByTestId('studio-form-field-draft-chip').map((chip) => chip.getAttribute('data-draft-of')).sort(),
    ).toEqual(['priority', 'renewal_count']);
  });

  it('one AI entry reads in the singular', async () => {
    serveDraft([AI_TWO[1]]);
    renderPillar();
    expect(await screen.findByTestId('studio-copilot-changes')).toHaveTextContent(
      tFormat('engine.studio.copilotChanges.lineOne', 'en-US', { count: 1 }),
    );
  });

  it('放弃全部未发布改动 discards the package’s drafts after a confirm; a declined confirm sends nothing', async () => {
    serveDraft(AI_TWO);
    // jsdom draws no confirm; the pillar asks the window's.
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const original = window.confirm;
    window.confirm = confirm;
    renderPillar();
    const discard = await screen.findByTestId('studio-copilot-changes-discard');
    expect(discard).toHaveTextContent(L('engine.studio.copilotChanges.discardAll'));
    fireEvent.click(discard);
    expect(confirm).toHaveBeenCalledWith(L('engine.studio.copilotChanges.discardConfirm'));
    expect(discardDrafts).not.toHaveBeenCalled();

    const reads = mockClient.getDraft.mock.calls.length;
    draftEnvelope = null;
    fireEvent.click(discard);
    await waitFor(() => expect(discardDrafts).toHaveBeenCalledWith('com.example.showcase'));
    // The open object is read again, and the line goes with the draft.
    await waitFor(() => expect(mockClient.getDraft.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.queryByTestId('studio-copilot-changes')).toBeNull());
    window.confirm = original;
  });

  it('a discard that fails names each item by its label; the server’s words stay under Details', async () => {
    serveDraft(AI_TWO);
    discardDrafts.mockResolvedValueOnce({
      success: false,
      failedCount: 2,
      failed: [
        { type: 'object', name: 'showcase_task', error: 'E_LOCKED: row held by txn 42' },
        { type: 'view', name: 'showcase_task_grid', error: 'E_GONE' },
      ],
      discarded: [],
    } as never);
    const original = window.confirm;
    window.confirm = vi.fn(() => true);
    renderPillar();
    fireEvent.click(await screen.findByTestId('studio-copilot-changes-discard'));
    const message = await screen.findByTestId('studio-refusal-message');
    expect(message).toHaveTextContent(
      tFormat('engine.studio.copilotChanges.discardFailed', 'en-US', {
        items: ['Task', 'showcase_task_grid'].join(L('engine.studio.copilotChanges.itemSeparator')),
      }),
    );
    expect(message.textContent).not.toContain('E_LOCKED');
    expect(message.textContent).not.toContain('object/');
    expect(screen.getByTestId('studio-refusal-detail')).toHaveTextContent('object/showcase_task: E_LOCKED: row held by txn 42');
    window.confirm = original;
  });

  it('the copilot’s chip reads the object’s label and the view on screen', async () => {
    const onSurfaceLabelChange = vi.fn();
    renderPillar({ onSurfaceLabelChange });
    await waitFor(() =>
      expect(onSurfaceLabelChange).toHaveBeenLastCalledWith({
        type: 'object',
        name: 'showcase_task',
        label: `Task · ${L('engine.studio.data.tab.records')}`,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: L('engine.studio.data.tab.form') }));
    await waitFor(() =>
      expect(onSurfaceLabelChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: `Task · ${L('engine.studio.data.tab.form')}` }),
      ),
    );
  });

  it('CONTROL: entries a person wrote in Studio, or no draft at all, draw no line', async () => {
    serveDraft([{ path: ['fields', 'renewal_count'], by: 'studio', actor: 'usr_1', at: minutesAgo(2) }]);
    renderPillar();
    await screen.findByRole('button', { name: L('engine.studio.data.tab.form') });
    await waitFor(() => expect(mockClient.getDraft).toHaveBeenCalled());
    expect(screen.queryByTestId('studio-copilot-changes')).toBeNull();
    cleanup();

    renderPillar();
    await screen.findByRole('button', { name: L('engine.studio.data.tab.form') });
    expect(screen.queryByTestId('studio-copilot-changes')).toBeNull();
  });
});

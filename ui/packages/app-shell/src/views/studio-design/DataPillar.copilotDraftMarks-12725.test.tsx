// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (item 3) — the Data pillar's field properties mark a field
 * the AI copilot changed: the draft chip in the rail's header, and the source
 * line 「由 AI 副驾在 N 分钟前作为草稿加入」 under the field's properties.
 *
 * What it reads: the object's strict draft read (`getDraft`) serves the
 * pending draft's per-key provenance, `draftChanges`, beside `item`
 * (objectstack#24298 / #24395). The field's key path is `["fields", NAME]`,
 * and the entry that answers for it is the longest prefix.
 *
 * Pinned:
 *  - a field whose answering entry is `by: 'copilot'` shows the chip and the
 *    source line, with N minutes from `at`;
 *  - `studio` and `api` show neither (a person in Studio, any other caller);
 *  - CONTROL: a draft whose read recorded no `draftChanges` shows neither, and
 *    neither does a published object with no draft.
 *
 * The rail holds the REAL registered `ObjectFieldInspector`.
 *
 * objectstack#32610 — the same marks after a copilot write that lands while
 * the field is open: the pillar re-reads the open object on the assistant
 * bus's pulse (`emitMetadataRefresh`, sent by `ChatPane` as the copilot's
 * drafted result lands and as its undo finishes). Pinned:
 *  - the open field properties re-read: the chip, the copilot's help text,
 *    and a field the same draft added is on the Form canvas, the rail open;
 *  - a re-read that no longer has the open field closes its properties;
 *  - CONTROL: a pulse while the buffer's save is in flight is held, not
 *    dropped, and replaces nothing until that save lands; a pulse re-reads
 *    the open object only, never another one in the rail.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  list: vi.fn(async (type: string) =>
    type === 'object'
      ? [
          { name: 'showcase_task', label: 'Task' },
          { name: 'showcase_project', label: 'Project' },
        ]
      : [],
  ),
  listDrafts: vi.fn(async () => []),
  // objectstack#29793 — the stored draft is the layered read's `draft` layer.
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

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';
import { t, tFormat } from '../metadata-admin/i18n';
import { emitMetadataRefresh } from '../../assistant/assistantBus';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataInspector('object', ObjectFieldInspector);

beforeEach(() => {
  draftEnvelope = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const L = (key: string) => t(key, 'en-US');

/** A draft read of the object, the draft body as-is, with `draftChanges` when given. */
function serveDraft(draftChanges?: unknown[]) {
  draftEnvelope = {
    type: 'object',
    name: 'showcase_task',
    item: { ...objectDef, _draft: true },
    version: 'v1',
    ...(draftChanges ? { draftChanges } : {}),
  };
}

/** Render the pillar, open Form, select the field labelled `label`, and return the open rail. */
async function openRail(label: string, name: string): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: L('engine.studio.data.tab.form') }));
  const card = (await screen.findByText(label)).closest('[role="button"]') as HTMLElement;
  fireEvent.click(card);
  const rail = await waitFor(() => {
    const el = screen.getByTestId('data-field-inspector');
    expect(el).toHaveTextContent(L('engine.studio.data.fieldProps'));
    return el;
  });
  // The shipped inspector is mounted: its API-name control carries the field's name.
  expect(await within(rail).findByDisplayValue(name, undefined, { timeout: 8000 })).toBeInTheDocument();
  return rail;
}

const SOURCE_2_MIN = tFormat('engine.studio.draftMark.source', 'en-US', {
  agent: tFormat('engine.studio.draftMark.agent.copilot', 'en-US', {}),
  when: tFormat('engine.studio.draftMark.minutesAgo', 'en-US', { n: 2 }),
});

describe('Data pillar field properties — the copilot’s draft marks (objectui#12725)', () => {
  it('a field the copilot changed shows the draft chip and the source line, N minutes from `at`', async () => {
    serveDraft([
      { path: [], by: 'studio', actor: 'usr_1', at: minutesAgo(30) },
      { path: ['fields', 'renewal_count'], by: 'copilot', actor: 'usr_1', at: minutesAgo(2) },
    ]);
    const rail = await openRail('Renewals', 'renewal_count');
    expect(within(rail).getByTestId('studio-draft-chip')).toHaveTextContent(L('engine.studio.draftMark.chip'));
    const source = within(rail).getByTestId('studio-draft-source');
    expect(source).toHaveTextContent(L('engine.studio.draftMark.sourceLabel'));
    expect(source).toHaveTextContent(SOURCE_2_MIN);
  });

  it('a copilot change to one property of the field marks the field too (an entry under its path)', async () => {
    serveDraft([{ path: ['fields', 'renewal_count', 'label'], by: 'copilot', actor: 'usr_1', at: minutesAgo(2) }]);
    const rail = await openRail('Renewals', 'renewal_count');
    expect(within(rail).getByTestId('studio-draft-source')).toHaveTextContent(SOURCE_2_MIN);
  });

  it.each(['studio', 'api'])('a field last changed through `%s` shows no copilot mark', async (by) => {
    serveDraft([
      { path: ['fields', 'renewal_count'], by: 'copilot', actor: 'usr_1', at: minutesAgo(9) },
      { path: ['fields', 'priority'], by, actor: 'usr_1', at: minutesAgo(2) },
    ]);
    const rail = await openRail('Priority', 'priority');
    expect(within(rail).queryByTestId('studio-draft-chip')).toBeNull();
    expect(within(rail).queryByTestId('studio-draft-source')).toBeNull();
  });

  it('CONTROL: a draft whose read recorded no `draftChanges` shows no mark', async () => {
    serveDraft();
    const rail = await openRail('Renewals', 'renewal_count');
    expect(within(rail).queryByTestId('studio-draft-chip')).toBeNull();
    expect(within(rail).queryByTestId('studio-draft-source')).toBeNull();
  });

  it('CONTROL: a published object with no pending draft shows no mark', async () => {
    const rail = await openRail('Renewals', 'renewal_count');
    expect(within(rail).queryByTestId('studio-draft-chip')).toBeNull();
    expect(within(rail).queryByTestId('studio-draft-source')).toBeNull();
  });
});

/** The copilot's tool wrote this draft server-side: help text on Renewals and a new field. */
function serveCopilotDraft() {
  draftEnvelope = {
    type: 'object',
    name: 'showcase_task',
    item: {
      ...objectDef,
      fields: {
        ...objectDef.fields,
        renewal_count: { ...objectDef.fields.renewal_count, inlineHelpText: 'Counts each renewal' },
        impact_scope: { name: 'impact_scope', label: 'Impact scope', type: 'text' },
      },
      _draft: true,
    },
    version: 'v2',
    draftChanges: [
      { path: ['fields', 'renewal_count', 'inlineHelpText'], by: 'copilot', actor: 'usr_1', at: minutesAgo(0) },
      { path: ['fields', 'impact_scope'], by: 'copilot', actor: 'usr_1', at: minutesAgo(0) },
    ],
  };
}

/** The pulse `ChatPane` sends as the copilot's drafted result lands (or its undo finishes). */
async function copilotPulse() {
  await act(async () => {
    emitMetadataRefresh();
  });
}

const draftReadsOf = (name: string) =>
  (mockClient.getDraft.mock.calls as unknown as Array<[string, string]>).filter(([type, n]) => type === 'object' && n === name).length;

describe('Data pillar field properties — a copilot write while the field is open (objectstack#32610)', () => {
  it('the open field properties and the Form canvas re-read on the pulse, the rail still open', async () => {
    const rail = await openRail('Renewals', 'renewal_count');
    expect(within(rail).queryByTestId('studio-draft-chip')).toBeNull();
    expect(screen.queryByText('Impact scope')).toBeNull();
    const before = draftReadsOf('showcase_task');

    serveCopilotDraft();
    await copilotPulse();

    await waitFor(() => expect(within(screen.getByTestId('data-field-inspector')).getByTestId('studio-draft-chip')).toBeInTheDocument());
    const open = screen.getByTestId('data-field-inspector');
    expect(within(open).getByDisplayValue('renewal_count')).toBeInTheDocument();
    expect(within(open).getByDisplayValue('Counts each renewal')).toBeInTheDocument();
    expect(await screen.findByText('Impact scope')).toBeInTheDocument();
    expect(draftReadsOf('showcase_task')).toBe(before + 1);
  });

  it('a re-read that no longer has the open field closes its properties', async () => {
    serveCopilotDraft();
    await openRail('Impact scope', 'impact_scope');

    // The undo discarded the draft: the object is back to its published fields.
    draftEnvelope = null;
    await copilotPulse();

    await waitFor(() => expect(screen.queryByText('Impact scope')).toBeNull());
    expect(screen.queryByTestId('data-field-inspector')).toBeNull();
  });

  it('CONTROL: a pulse during an unsent save is held — nothing is replaced until the save lands, then it is re-read', async () => {
    const rail = await openRail('Renewals', 'renewal_count');
    let landSave: (value: unknown) => void = () => {};
    mockClient.save.mockImplementationOnce(() => new Promise((resolve) => (landSave = resolve)));
    const label = within(rail).getByTestId('field-label-input');
    fireEvent.change(label, { target: { value: 'Renewal total' } });
    fireEvent.blur(label);
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
    const before = draftReadsOf('showcase_task');

    serveCopilotDraft();
    await copilotPulse();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    // Held: no re-read, and the author's edit is what the rail shows.
    expect(draftReadsOf('showcase_task')).toBe(before);
    expect(within(screen.getByTestId('data-field-inspector')).getByTestId('field-label-input')).toHaveValue('Renewal total');
    expect(screen.queryByText('Impact scope')).toBeNull();

    // The author's save lands: the held pulse is released, not dropped.
    await act(async () => {
      landSave({});
    });
    await waitFor(() => expect(draftReadsOf('showcase_task')).toBe(before + 1), { timeout: 8000 });
    expect(await screen.findByText('Impact scope')).toBeInTheDocument();
  });

  it('CONTROL: a pulse re-reads the open object only, never another one in the rail', async () => {
    await openRail('Renewals', 'renewal_count');
    const before = draftReadsOf('showcase_task');

    serveCopilotDraft();
    await copilotPulse();

    await waitFor(() => expect(draftReadsOf('showcase_task')).toBe(before + 1));
    expect(draftReadsOf('showcase_project')).toBe(0);
  });
});

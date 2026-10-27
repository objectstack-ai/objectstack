// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — a refused publish stays on its Pending changes entry.
 *
 * Measured before this card: a refused publish was a toast of the publish
 * rules' own text (stack paths, engine source), gone in about four seconds,
 * and the Pending changes sheet kept nothing. The surface now keeps each
 * causal failure, read in the designer's words against the draft the publish
 * judged, and hands it to the sheet for that draft's entry until it is
 * resolved: the draft saved again, or a publish that lets it through.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape,
 * with the real `FlowPreview` / `FlowInspector`. The sheet is a probe that
 * draws what the surface's `renderEntryNote` answers for each pending entry,
 * and toasts are mocked, so what the probe shows is what stays once the toast
 * is gone.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';

const PKG = 'com.acme.app';

/** A publish rule's message: written for the command line, quoting engine source. */
const ENGINE_TEXT = 'A `notify` step with no `config.title` sends an empty message (`notify.ts` — `if (!cfg.title) return`)';
const RAW_PATH = 'flows[0].nodes[1].config.title';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'obsolete',
  _packageId: PKG,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'tell', type: 'notify', label: 'Notify approver', config: { title: 'Done', recipients: ['owner'] } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'tell' },
    { id: 'e2', source: 'tell', target: 'end' },
  ],
};

/** The pending entries, as the sheet folds them (`DraftChangeEntry`). */
const ENTRIES = vi.hoisted(() => [
  { type: 'flow', name: 'approval', packageId: 'com.acme.app' },
  { type: 'object', name: 'invoice', packageId: 'com.acme.app' },
]);

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'approval', label: 'Approval', _packageId: 'com.acme.app' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null })),
  getDraft: vi.fn(async (type: string, name: string): Promise<unknown> => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => ({})),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] }) as Record<string, unknown>),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

/** What the surface handed the pending-changes sheet, last render. */
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

// The sheet: each pending entry with the note the surface gives it.
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: Record<string, unknown>) => {
    panel.props = props;
    const renderEntryNote = props.renderEntryNote as ((entry: unknown) => React.ReactNode) | undefined;
    return (
      <ul data-testid="changes-probe">
        {ENTRIES.map((entry) => (
          <li key={entry.name} data-testid={`entry-${entry.name}`}>
            {renderEntryNote?.(entry)}
          </li>
        ))}
      </ul>
    );
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

// The pending-drafts feed lists both entries; `objects` is a stored plural spelling.
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    if (String(input).startsWith('/api/v1/meta/_drafts')) {
      return new Response(
        JSON.stringify({
          drafts: [
            { type: 'flow', name: 'approval', packageId: PKG },
            { type: 'objects', name: 'invoice', packageId: PKG },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
  }),
);

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
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

/** The batch the gate refuses: the flow is causal, the object rolled back with it. */
const REFUSED = {
  success: false,
  outcome: 'refused',
  publishedCount: 0,
  published: [],
  failed: [
    {
      type: 'flows',
      name: 'approval',
      error: 'flow/approval failed the authoring gate',
      code: 'invalid_metadata',
      issues: [{ path: RAW_PATH, message: ENGINE_TEXT }],
    },
    { type: 'object', name: 'invoice', error: 'rolled back with the batch', code: 'BATCH_ABORTED' },
  ],
};

const PUBLISHED = { success: true, outcome: 'published', published: [{ type: 'flow', name: 'approval' }], failed: [] };

const EXPECTED_SENTENCE = tFormat('engine.studio.refusal.publishWhere', 'en', {
  where: tFormat('engine.studio.refusal.stepInput', 'en', { input: 'Title', step: 'Notify approver' }),
});

beforeEach(() => {
  panel.props = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.layered.mockImplementation(async () => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: JSON.parse(JSON.stringify(FLOW)),
  }));
  // The draft the publish judged, read back to place its issues.
  mockClient.getDraft.mockImplementation(async (type: string, name: string) => {
    if (type === 'flows' && name === 'approval') return { item: JSON.parse(JSON.stringify(FLOW)) };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function openFlow(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTitle('API name: approval', undefined, { timeout: 8000 });
}

/** The surface's publish, as the sheet's footer calls it, answered with `answer`. */
async function publish(answer: Record<string, unknown>): Promise<void> {
  mockClient.publishPackageDrafts.mockImplementationOnce(async () => answer);
  const onPublish = panel.props?.onPublish as (() => Promise<void>) | undefined;
  expect(onPublish, 'the sheet is handed a publish').toBeTypeOf('function');
  await act(async () => {
    await onPublish!();
  });
}

const noteOf = (name: string) => within(screen.getByTestId(`entry-${name}`)).queryByTestId('studio-refusal');

describe('a refused publish stays on its Pending changes entry (objectstack#26730)', () => {
  it('keeps the refusal, in the designer\'s words, with the raw text under Details', async () => {
    await openFlow();
    await publish(REFUSED);

    const note = noteOf('approval');
    expect(note, 'the refusal outlives its toast').not.toBeNull();
    const message = within(note!).getByTestId('studio-refusal-message');
    expect(message).toHaveTextContent(EXPECTED_SENTENCE);
    expect(message.textContent).not.toMatch(/notify\.ts|config\.title|flows\[|`/);
    const details = within(note!).getByTestId('studio-refusal-detail') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('pre')).toHaveTextContent(`• ${RAW_PATH} — ${ENGINE_TEXT}`);

    // A sibling rolled back with the batch carries nothing of its own.
    expect(noteOf('invoice')).toBeNull();

    // The toast points at the sheet, says why the batch waits, and quotes no engine text.
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, options] = vi.mocked(toast.error).mock.calls[0] as [string, { description?: string }];
    expect(title).toBe(tFormat('engine.studio.publishRefusedOne', 'en', { count: 1 }));
    expect(options.description).toContain(t('engine.studio.publishRefusedBatch', 'en'));
    expect(options.description).toContain(`approval: ${EXPECTED_SENTENCE}`);
    expect(options.description).not.toMatch(/notify\.ts|flows\[|`/);
  });

  it('saving the draft again clears it', async () => {
    await openFlow();
    await publish(REFUSED);
    expect(noteOf('approval')).not.toBeNull();

    // The header switch saves the flow at once.
    const toggle = await screen.findByRole('switch', undefined, { timeout: 8000 });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    await waitFor(() => expect(noteOf('approval')).toBeNull());
  });

  it('a publish that lets it through clears it', async () => {
    await openFlow();
    await publish(REFUSED);
    expect(noteOf('approval')).not.toBeNull();

    await publish(PUBLISHED);
    expect(noteOf('approval')).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  // CONTROL: nothing refused, nothing kept.
  it('a successful publish shows no refusal', async () => {
    await openFlow();
    await publish(PUBLISHED);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});

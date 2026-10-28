// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26858 — on the Studio Automations page, the flow edge condition
 * shows what the pending draft's publish will refuse at that condition.
 *
 * The page reads the flow's draft itself (it is not the metadata edit page),
 * so the verdict the draft read serves since objectstack#26707 never reached
 * an inspector. The page now keeps that verdict, provides it to the inspector
 * (`DraftVerdictContext`), and reads it again after each draft save.
 *
 * The inspector is the real registered `FlowInspector`, which opens
 * `FlowEdgeInspector` for an edge; the canvas is a stand-in that selects an
 * edge and edits the flow on demand. The client is a server double whose draft
 * read judges a stored draft the way `expression-invalid` does: it refuses an
 * edge condition that does not parse, at `edges.N.condition`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';
const BROKEN = 'record.name ==';
const REFUSAL = 'Unexpected token: EOF — source: `record.name ==`';

const FLOW = {
  name: 'edge_cel',
  label: 'Edge CEL',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'decide', type: 'decision', label: 'Decide' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'decide' },
    { id: 'e2', source: 'decide', target: 'end', type: 'conditional', condition: BROKEN },
  ],
};

const server = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null, draftReads: 0 }));

/** The publish verdict on a stored draft: an edge condition that does not parse is refused at its path. */
function verdictOf(body: Record<string, unknown>) {
  const edges = (body.edges ?? []) as Array<{ condition?: string }>;
  const errors = edges.flatMap((e, i) =>
    e.condition === BROKEN ? [{ path: `edges.${i}.condition`, message: REFUSAL, code: 'expression-invalid' }] : [],
  );
  return errors.length ? { valid: false, errors } : { valid: true };
}

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'edge_cel', label: 'Edge CEL' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true })),
  getDraft: vi.fn(async (type: string, name: string) => {
    server.draftReads += 1;
    if (!server.draft) {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }
    return { type, name, item: { ...server.draft, _draft: true, _diagnostics: verdictOf(server.draft) } };
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => {
    server.draft = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    return { type, name, item };
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { getMetadataPreview, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';

const dataSource = createEmptyDataSource();

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** Canvas stand-in: selects the conditional edge, or rewrites its condition. */
function StubCanvas({
  onSelectionChange,
  onPatch,
}: {
  onSelectionChange?: (s: { kind: 'edge'; id: string; label?: string }) => void;
  onPatch?: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'edge', id: 'e2', label: 'Decide → End' })}>
        select e2
      </button>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'edge', id: 'e1', label: 'Start → Decide' })}>
        select e1
      </button>
      <button
        type="button"
        onClick={() =>
          onPatch?.({ edges: [FLOW.edges[0], { ...FLOW.edges[1], condition: "record.name == 'x'" }] })
        }
      >
        fix e2
      </button>
    </>
  );
}

const realFlow = getMetadataPreview('flow');
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  server.draft = JSON.parse(JSON.stringify(FLOW));
  server.draftReads = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('flow', StubCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realFlow) registerMetadataPreview('flow', realFlow);
});

function renderPillar() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

describe('Automations page — the edge condition shows the draft\'s served verdict at its path (objectstack#26858)', () => {
  it('the refused edge shows the server message; the other edge shows none', async () => {
    renderPillar();
    fireEvent.click(await screen.findByRole('button', { name: 'select e2' }, { timeout: 8000 }));
    expect(await screen.findByTestId('flow-edge-server-error', {}, { timeout: 8000 })).toHaveTextContent(REFUSAL);

    fireEvent.click(screen.getByRole('button', { name: 'select e1' }));
    await waitFor(() => expect(screen.queryByTestId('flow-edge-server-error')).toBeNull());
  });

  it('the verdict follows the draft: after the autosave of a fixed condition the refusal goes', async () => {
    renderPillar();
    fireEvent.click(await screen.findByRole('button', { name: 'select e2' }, { timeout: 8000 }));
    await screen.findByTestId('flow-edge-server-error', {}, { timeout: 8000 });
    const readsBefore = server.draftReads;

    fireEvent.click(screen.getByRole('button', { name: 'fix e2' }));

    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
    await waitFor(() => expect(server.draftReads).toBeGreaterThan(readsBefore), { timeout: 6000 });
    await waitFor(() => expect(screen.queryByTestId('flow-edge-server-error')).toBeNull(), { timeout: 6000 });
  });
});

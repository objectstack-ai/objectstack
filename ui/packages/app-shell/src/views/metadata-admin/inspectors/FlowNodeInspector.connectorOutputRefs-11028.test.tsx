// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11028 — a committed `connector_action` node's output keys reach the
 * scope of every node and edge downstream of it, through the REAL inspector
 * wiring: the inspector reads the runtime registry
 * (`GET /api/v1/automation/connectors`), hands it to `useFlowScope`, and the
 * `nodeOutputRefs` connector branch offers `nodeId.key` for each top-level
 * `properties` key of the action's `outputSchema`.
 *
 * Read through the scope-aware "not in scope" note, which judges a reference
 * against exactly the roots the data picker offers: a downstream reference to
 * the connector node's output is judged in scope once the action declares
 * output keys, and — the lit control on the same draft — still flagged when the
 * action declares none (keys are never guessed).
 *
 * The note's wording is not pinned: each probe asserts only whether a note
 * naming the connector node is present.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { FlowEdgeInspector } from './FlowEdgeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HISTORY_OUTPUT = {
  type: 'object',
  properties: { messages: { type: 'array' }, has_more: { type: 'boolean' } },
};

function mockRegistry(action: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        success: true,
        data: {
          connectors: [
            { name: 'slack', label: 'Slack', type: 'saas', origin: 'plugin', state: 'ready', actions: [action] },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A connector node feeding a loop over its output, then a guarded edge to the end. */
function makeDraft(connectorConfig: Record<string, unknown> = { connectorId: 'slack', actionId: 'conversations.history' }) {
  return {
    // A declared variable keeps the scope non-empty, so the reference check runs
    // whether or not the connector node contributes anything.
    variables: [{ name: 'threshold', type: 'number' }],
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'fetch_history', type: 'connector_action', label: 'Read channel history', connectorConfig },
      // A body-less loop reads `collection` as a bare reference (objectui#12329:
      // the single-brace spelling is retired, and the field judges it as CEL).
      { id: 'each', type: 'loop', label: 'For each message', config: { collection: 'fetch_history.messages' } },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'fetch_history' },
      { id: 'e2', source: 'fetch_history', target: 'each' },
      { id: 'e3', source: 'each', target: 'done', condition: 'fetch_history.has_more == false' },
    ],
  };
}

const common = {
  type: 'flow',
  name: 'digest_flow',
  onPatch: vi.fn(),
  onClearSelection: vi.fn(),
  locale: 'en-US' as const,
  readOnly: false,
};

function renderNode(draft: Record<string, unknown>, id = 'each') {
  const selection: MetadataSelection = { kind: 'node', id };
  return render(<FlowNodeInspector {...common} selection={selection} draft={draft} />);
}

function renderEdge(draft: Record<string, unknown>, id = 'e3') {
  const selection: MetadataSelection = { kind: 'edge', id };
  return render(<FlowEdgeInspector {...common} selection={selection} draft={draft} />);
}

/** Scope notes that name the connector node as an unknown root. */
function notesNamingConnector(): HTMLElement[] {
  return screen.queryAllByRole('note').filter((n) => (n.textContent ?? '').includes('fetch_history'));
}

/** Let the registry fetch resolve and its state land. */
async function settle(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('FlowNodeInspector — an upstream connector action’s output keys are in scope (objectui#11028)', () => {
  it('reads the registry for a downstream node and judges `fetch_history.messages` in scope', async () => {
    const fetchMock = mockRegistry({ key: 'conversations.history', label: 'History', outputSchema: HISTORY_OUTPUT });
    renderNode(makeDraft());

    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('/automation/connectors');
    await waitFor(() => expect(notesNamingConnector()).toHaveLength(0));
  });

  it('lit control: an action that declares no outputSchema offers no keys, so the reference stays flagged', async () => {
    const fetchMock = mockRegistry({ key: 'conversations.history', label: 'History' });
    renderNode(makeDraft());

    await settle(fetchMock);
    expect(notesNamingConnector()).toHaveLength(1);
  });

  it('a flow with no committed connector action never reads the registry for scope', async () => {
    const fetchMock = mockRegistry({ key: 'conversations.history', label: 'History', outputSchema: HISTORY_OUTPUT });
    renderNode(makeDraft({ connectorId: 'slack' }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // …and the reference is judged exactly as before: not in scope.
    expect(notesNamingConnector()).toHaveLength(1);
  });
});

describe('FlowEdgeInspector — an edge guard downstream of a connector action (objectui#11028)', () => {
  it('judges `fetch_history.has_more` in scope once the action declares it', async () => {
    mockRegistry({ key: 'conversations.history', label: 'History', outputSchema: HISTORY_OUTPUT });
    renderEdge(makeDraft());

    await waitFor(() => expect(notesNamingConnector()).toHaveLength(0));
  });

  it('lit control: with no declared output keys the guard’s reference stays flagged', async () => {
    const fetchMock = mockRegistry({ key: 'conversations.history', label: 'History' });
    renderEdge(makeDraft());

    await settle(fetchMock);
    expect(notesNamingConnector()).toHaveLength(1);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11028 — a `connector_action` node's action picker shows each action's
 * `description` beside its label, and nothing when the action authors none.
 *
 * The served registry (`GET /api/v1/automation/connectors`) has always carried a
 * per-action `description`; the picker mapped each action to `{ value, label }`
 * and dropped it, so an author chose between action keys with no word on what
 * each one does. Driven through the REAL render path: the chosen connector is
 * read off the node's `connectorConfig`, the registry is fetched, and the
 * suggestion list is what the `<datalist>` holds.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  // STABLE identity, like the real memoized client (see the sibling suites).
  metadataClient: { list: async () => [] as unknown[] },
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox } from './FlowReferenceField';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockRegistry(actions: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { connectors: [{ name: 'slack', label: 'Slack', type: 'saas', origin: 'plugin', state: 'ready', actions }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

/** Mount the action picker of a node whose connector is `slack`; resolve once the suggestions load. */
async function actionSuggestions(): Promise<Map<string, string>> {
  const { container } = render(
    <ReferenceCombobox
      resolved={{ kind: 'connector-action', connectorSource: 'connectorId' }}
      value=""
      onCommit={vi.fn()}
      context={{ draft: {}, node: { id: 'post', type: 'connector_action', connectorConfig: { connectorId: 'slack' } } }}
    />,
  );
  await waitFor(() => expect(container.querySelectorAll('datalist option').length).toBeGreaterThan(0));
  const out = new Map<string, string>();
  container.querySelectorAll('datalist option').forEach((o) => {
    out.set((o as HTMLOptionElement).value, o.textContent ?? '');
  });
  return out;
}

describe('the connector action picker shows each action’s description (objectui#11028)', () => {
  it('shows an authored description beside the label', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', description: 'Post a message to a channel' }]);
    const options = await actionSuggestions();
    expect(options.get('chat.postMessage')).toBe('Post Message (chat.postMessage) — Post a message to a channel');
  });

  it('shows the label alone when the action authors no description', async () => {
    mockRegistry([
      { key: 'chat.postMessage', label: 'Post Message', description: 'Post a message to a channel' },
      { key: 'chat.delete', label: 'Delete Message' },
    ]);
    const options = await actionSuggestions();
    // Lit control on the same mount: the described action still carries its text.
    expect(options.get('chat.postMessage')).toContain('Post a message to a channel');
    expect(options.get('chat.delete')).toBe('Delete Message (chat.delete)');
  });
});

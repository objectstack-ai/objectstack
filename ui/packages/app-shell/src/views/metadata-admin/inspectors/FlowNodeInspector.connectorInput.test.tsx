// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeInspector — a committed connector action's Input section derives typed
 * fields from the descriptor's `inputSchema` (#4305).
 *
 * The card's repro, driven through the REAL render path: a `connector_action`
 * node with a committed connector + action, against a runtime registry
 * (`GET /api/v1/automation/connectors`) whose action declares an `inputSchema`.
 * Before the fix the Input section is a single untyped key/value repeater and no
 * schema-derived field exists.
 *
 * The pins that must NOT move are here too: a descriptor with no `inputSchema`
 * keeps the byte-identical repeater, an unresolved connector keeps it, and every
 * edit round-trips through the SAME `connectorConfig.input` map (declared keys,
 * undeclared extras and their order all survive).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** slack-connector.ts `chat.postMessage`, verbatim (no additionalProperties). */
const SLACK_POST_MESSAGE = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string', description: 'Channel id, user id, or #name' },
    text: { type: 'string', description: 'Message text' },
    thread_ts: { type: 'string', description: 'Thread root ts to reply into' },
    blocks: { type: 'array', description: 'Block Kit blocks' },
  },
};

function mockRegistry(actions: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            connectors: [
              { name: 'slack', label: 'Slack', type: 'saas', origin: 'plugin', state: 'ready', actions },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

/** A committed connector action: connector + action chosen, inputs stored. */
function makeDraft(input: unknown = { channel: 'C123', legacy_note: 'keep me' }, actionId = 'chat.postMessage') {
  return {
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'post',
        type: 'connector_action',
        label: 'Post to Slack',
        connectorConfig: { connectorId: 'slack', actionId, ...(input === undefined ? {} : { input }) },
      },
    ],
    edges: [{ source: 'start', target: 'post' }],
  };
}

const SELECTION: MetadataSelection = { kind: 'node', id: 'post' };

function renderInspector(draft: Record<string, unknown>) {
  const onPatch = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="notify_flow"
      selection={SELECTION}
      draft={draft}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      locale="en-US"
      readOnly={false}
    />,
  );
  return { onPatch, ...utils };
}

/**
 * The input bound to a TYPED field, found via its label.
 *
 * Deliberately not `getByDisplayValue(...)`: the untyped repeater also renders
 * the stored value in a cell, so a bare display-value probe passes on the
 * UNFIXED code and can never go red (measured — it did, on the red-first run).
 * Going through the label is what separates "a typed Channel field holds C123"
 * from "some repeater row happens to show C123".
 */
function typedFieldInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`no input under the "${labelText}" field label`);
  return input as HTMLInputElement;
}

/** The node as the inspector would write it back, read off the last onPatch. */
function patchedInput(onPatch: ReturnType<typeof vi.fn>): unknown {
  expect(onPatch).toHaveBeenCalled();
  const patch = onPatch.mock.calls.at(-1)![0] as { nodes?: Array<Record<string, unknown>> };
  const node = (patch.nodes ?? []).find((n) => n.id === 'post')!;
  return (node.connectorConfig as Record<string, unknown> | undefined)?.input;
}

describe('#4305 — the Input section derives typed fields from the descriptor inputSchema', () => {
  it('renders a typed field per declared input key, labelled from the descriptor', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    renderInspector(makeDraft());

    expect(await screen.findByText('Channel')).toBeTruthy();
    expect(screen.getByText('Text')).toBeTruthy();
    expect(screen.getByText('Thread Ts')).toBeTruthy();
    // The descriptor's own `description` is the label/help channel — no new UI copy.
    expect(screen.getByText('Channel id, user id, or #name')).toBeTruthy();
  });

  it('renders a STORED input value into its typed field (not just an empty form)', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    renderInspector(makeDraft());

    await screen.findByText('Channel');
    expect(typedFieldInput('Channel').value).toBe('C123');
    // An unset declared key renders as an empty typed field, not as nothing.
    expect(typedFieldInput('Text').value).toBe('');
  });

  it('editing a typed field writes back into the SAME input map, preserving every other key', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const { onPatch } = renderInspector(makeDraft());

    await screen.findByText('Channel');
    fireEvent.change(typedFieldInput('Channel'), { target: { value: 'C999' } });

    expect(patchedInput(onPatch)).toEqual({ channel: 'C999', legacy_note: 'keep me' });
  });

  it('filling a previously-unset declared key ADDS it without disturbing the stored keys', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const { onPatch } = renderInspector(makeDraft());

    await screen.findByText('Text');
    fireEvent.change(typedFieldInput('Text'), { target: { value: 'hello' } });

    expect(patchedInput(onPatch)).toEqual({ channel: 'C123', legacy_note: 'keep me', text: 'hello' });
  });

  it('an undeclared stored key stays editable in the extras repeater (schema is OPEN)', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    renderInspector(makeDraft());

    // Two settlings to wait out, not one: the registry fetch (which adds the
    // typed fields), and THEN the repeater's own resync — it keeps its rows in
    // local draft state and rebuilds them from the trimmed value one render
    // later. Probing between the two reads the pre-trim rows and would fail
    // against correct behaviour (measured: it did).
    await screen.findByText('Channel');
    // …never re-offering a key that now has its own typed field.
    await waitFor(() => expect(screen.queryByDisplayValue('channel')).toBeNull());
    // The repeater survives, holding ONLY the undeclared key.
    expect(screen.getByDisplayValue('legacy_note')).toBeTruthy();
  });

  it('editing an extra through the repeater preserves the typed keys (the commit MERGES, never replaces)', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const { onPatch } = renderInspector(makeDraft());

    await screen.findByText('Channel');
    // Grab the cell only once the repeater has resynced to the extras-only rows
    // — the pre-resync element is replaced, so editing it would commit nothing.
    await waitFor(() => expect(screen.queryByDisplayValue('channel')).toBeNull());
    const extraValue = screen.getByDisplayValue('keep me');
    fireEvent.change(extraValue, { target: { value: 'edited' } });
    fireEvent.blur(extraValue);

    expect(patchedInput(onPatch)).toEqual({ channel: 'C123', legacy_note: 'edited' });
  });

  it('a CLOSED schema (additionalProperties:false) drops the repeater', async () => {
    mockRegistry([
      {
        key: 'chat.postMessage',
        label: 'Post Message',
        inputSchema: { ...SLACK_POST_MESSAGE, additionalProperties: false },
      },
    ]);
    renderInspector(makeDraft({ channel: 'C123' }));

    expect(await screen.findByText('Channel')).toBeTruthy();
    // No key cell at all — the repeater is gone, not merely empty.
    expect(screen.queryByPlaceholderText('Key')).toBeNull();
  });

  it('a CLOSED schema still shows stored extras, so existing config is never hidden', async () => {
    mockRegistry([
      {
        key: 'chat.postMessage',
        label: 'Post Message',
        inputSchema: { ...SLACK_POST_MESSAGE, additionalProperties: false },
      },
    ]);
    renderInspector(makeDraft());

    await screen.findByText('Channel');
    // …while the declared key it DOES cover has moved to its typed field.
    await waitFor(() => expect(screen.queryByDisplayValue('channel')).toBeNull());
    // The legacy key the closed schema does not declare is still reachable…
    expect(screen.getByDisplayValue('legacy_note')).toBeTruthy();
    expect(typedFieldInput('Channel').value).toBe('C123');
  });
});

describe('#4305 — pins that must NOT move', () => {
  it('a descriptor with NO inputSchema keeps the generic repeater, showing every key', async () => {
    mockRegistry([{ key: 'plain', label: 'Plain' }]);
    renderInspector(makeDraft({ channel: 'C123', legacy_note: 'keep me' }, 'plain'));

    expect(await screen.findByDisplayValue('channel')).toBeTruthy();
    expect(screen.getByDisplayValue('legacy_note')).toBeTruthy();
    // …and no schema-derived field appeared.
    expect(screen.queryByText('Thread Ts')).toBeNull();
  });

  it('a no-schema descriptor still commits the whole map through the repeater', async () => {
    mockRegistry([{ key: 'plain', label: 'Plain' }]);
    const { onPatch } = renderInspector(makeDraft({ channel: 'C123' }, 'plain'));

    const valueCell = await screen.findByDisplayValue('C123');
    fireEvent.change(valueCell, { target: { value: 'C999' } });
    fireEvent.blur(valueCell);

    expect(patchedInput(onPatch)).toEqual({ channel: 'C999' });
  });

  it('an unreachable registry leaves the repeater exactly as it was', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    renderInspector(makeDraft());

    expect(await screen.findByDisplayValue('channel')).toBeTruthy();
    expect(screen.queryByText('Thread Ts')).toBeNull();
  });

  it('a node with no action committed yet keeps the repeater', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    render(
      <FlowNodeInspector
        type="flow"
        name="notify_flow"
        selection={SELECTION}
        draft={{ nodes: [{ id: 'post', type: 'connector_action', connectorConfig: { connectorId: 'slack', input: { channel: 'C1' } } }], edges: [] }}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        locale="en-US"
        readOnly={false}
      />,
    );

    expect(await screen.findByDisplayValue('channel')).toBeTruthy();
    expect(screen.queryByText('Thread Ts')).toBeNull();
  });

  it('an ARRAY-shaped input is left wholly to the repeater (never coerced to an object)', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    renderInspector(makeDraft([{ variable: 'channel', value: 'C123' }]));

    expect(await screen.findByDisplayValue('channel')).toBeTruthy();
    expect(screen.queryByText('Thread Ts')).toBeNull();
  });

  it('the connector + action pickers still render (the picker behaviours are untouched)', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    renderInspector(makeDraft());

    // The field's label: since objectui#11778 the Node Type select names this
    // node's type "Connector" too (the palette's name), not `connector_action`.
    await waitFor(() => expect(screen.getByText('Connector', { selector: 'label' })).toBeTruthy());
    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByDisplayValue('slack')).toBeTruthy();
    expect(screen.getByDisplayValue('chat.postMessage')).toBeTruthy();
  });
});

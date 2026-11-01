// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeInspector — a `connector_action` node's input values are value slots
 * (objectstack#28164).
 *
 * The spec's expression ledger roots `connector_action` `input.*` in the node's
 * `connectorConfig` sibling block, and `registerFlow` refuses a `{…}` token
 * there. The form gives each input value what every other value slot has: the
 * text / CEL-expression toggle, and the spec's refusal beside the value as it
 * is typed, read from the same judge the publish door calls. Driven through the
 * real render path, for both editors the Input section uses: a typed field
 * (the action declares an `inputSchema`) and the key/value repeater (it
 * declares none).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { flowNodeValueTemplateRefusals } from '@objectstack/spec/automation';

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

const TOGGLE = 'Write as a CEL expression';

const SLACK_POST_MESSAGE = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string', description: 'Channel id, user id, or #name' },
    text: { type: 'string', description: 'Message text' },
  },
};

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

function connectorNode(input: Record<string, unknown>, actionId = 'chat.postMessage') {
  return { id: 'post', type: 'connector_action', label: 'Post to Slack', connectorConfig: { connectorId: 'slack', actionId, input } };
}

const SELECTION: MetadataSelection = { kind: 'node', id: 'post' };

/** The inspector over a draft that takes each patch, as the designer host does. */
function Host({ initial, onPatch }: { initial: Record<string, unknown>; onPatch: (patch: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <FlowNodeInspector
      type="flow"
      name="notify_flow"
      selection={SELECTION}
      draft={draft}
      onPatch={(patch: Record<string, unknown>) => {
        onPatch(patch);
        setDraft((d) => ({ ...d, ...patch }));
      }}
      onClearSelection={vi.fn()}
      locale="en-US"
      readOnly={false}
    />
  );
}

function renderInspector(input: Record<string, unknown>, actionId?: string) {
  const onPatch = vi.fn();
  const initial = { nodes: [{ id: 'start', type: 'start' }, connectorNode(input, actionId)], edges: [{ source: 'start', target: 'post' }] };
  render(<Host initial={initial} onPatch={onPatch} />);
  return { onPatch };
}

/** The spec's refusal of `input` on the node, at `connectorConfig.input.KEY`. */
function specRefusal(input: Record<string, unknown>, key: string): string {
  const node = connectorNode(input);
  const found = flowNodeValueTemplateRefusals('connector_action', {}, node).find(
    (r) => r.block === 'connectorConfig' && r.path === `input.${key}`,
  );
  expect(found, `the spec refuses connectorConfig.input.${key}`).toBeDefined();
  return found!.message;
}

/** The control group a typed field's label heads. */
function typedField(labelText: string): HTMLElement {
  const group = screen.getByText(labelText, { selector: 'label' }).parentElement;
  if (!group) throw new Error(`no group under the "${labelText}" label`);
  return group;
}

function lastInput(onPatch: ReturnType<typeof vi.fn>): unknown {
  expect(onPatch).toHaveBeenCalled();
  const patch = onPatch.mock.calls.at(-1)![0] as { nodes?: Array<Record<string, unknown>> };
  const node = (patch.nodes ?? []).find((n) => n.id === 'post')!;
  return (node.connectorConfig as Record<string, unknown>).input;
}

describe('#28164 — a typed connector input is a value slot', () => {
  it('shows the spec’s refusal in the form when a `{…}` token is typed into the value', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const { onPatch } = renderInspector({ channel: 'C123' });

    await screen.findByText('Text', { selector: 'label' });
    const field = typedField('Text');
    expect(within(field).queryByRole('alert')).toBeNull();
    fireEvent.change(within(field).getByRole('textbox'), { target: { value: 'Hello {record.name}' } });

    expect(lastInput(onPatch)).toEqual({ channel: 'C123', text: 'Hello {record.name}' });
    const alert = await within(typedField('Text')).findByRole('alert');
    expect(alert.textContent).toContain(specRefusal({ channel: 'C123', text: 'Hello {record.name}' }, 'text'));
  });

  it('shows the refusal for a stored token, and none for a plain literal', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const stored = { channel: 'C123', text: 'Hi {name}' };
    renderInspector(stored);

    await screen.findByText('Text', { selector: 'label' });
    expect(within(typedField('Text')).getByRole('alert').textContent).toContain(specRefusal(stored, 'text'));
    expect(within(typedField('Channel')).queryByRole('alert')).toBeNull();
  });

  it('offers the expression toggle, which stores a CEL value envelope at the same key', async () => {
    mockRegistry([{ key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE }]);
    const { onPatch } = renderInspector({ channel: 'C123' });

    await screen.findByText('Text', { selector: 'label' });
    const field = typedField('Text');
    fireEvent.change(within(field).getByRole('textbox'), { target: { value: "'Hello ' + record.name" } });
    fireEvent.click(within(field).getByRole('button', { name: TOGGLE }));

    expect(lastInput(onPatch)).toEqual({ channel: 'C123', text: { dialect: 'cel', source: "'Hello ' + record.name" } });
    expect(within(typedField('Text')).queryByRole('alert')).toBeNull();
  });
});

describe('#28164 — the Input repeater’s values are value slots', () => {
  it('shows the spec’s refusal under a repeater value holding a `{…}` token, and offers the toggle', async () => {
    mockRegistry([{ key: 'plain', label: 'Plain' }]);
    const stored = { channel: 'C123', note: 'Hi {name}' };
    renderInspector(stored, 'plain');

    await screen.findByDisplayValue('note');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(specRefusal(stored, 'note'));
    expect(screen.getAllByRole('button', { name: TOGGLE })).toHaveLength(2);
  });

  it('a token typed into a repeater value is refused in place', async () => {
    mockRegistry([{ key: 'plain', label: 'Plain' }]);
    renderInspector({ channel: 'C123' }, 'plain');

    const cell = await screen.findByDisplayValue('C123');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(cell, { target: { value: '{record.channel}' } });
    fireEvent.blur(cell);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(specRefusal({ channel: '{record.channel}' }, 'channel')),
    );
  });
});

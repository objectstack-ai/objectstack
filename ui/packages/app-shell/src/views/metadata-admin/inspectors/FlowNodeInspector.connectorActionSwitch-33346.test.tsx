// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeInspector — switching a `connector_action` node's action resets its
 * Input map to the new action's inputs (objectstack#33346, row 254): the held
 * keys the new action declares are kept as they were, the rest are dropped,
 * and with no known schema for the new action the map is empty.
 *
 * The defect: the Action box wrote `connectorConfig.actionId` alone, so the
 * previous action's input keys stayed in `connectorConfig.input`. They drew as
 * repeater rows under the new action AND were saved with the draft, and the
 * executor hands the whole map to the action's handler (the action's input
 * schema is open, so nothing refuses an undeclared key): the stale inputs were
 * sent to the new action.
 *
 * Driven through the real render path: the Action box is typed into, every
 * write is read off `onPatch` (the draft the designer saves), and the draft is
 * re-rendered from that patch to read what the author sees.
 */

// The source loads this lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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

const POST_MESSAGE = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string', description: 'Channel id, user id, or #name' },
    text: { type: 'string', description: 'Message text' },
    thread_ts: { type: 'string', description: 'Thread root ts to reply into' },
  },
};
const SCHEDULE_MESSAGE = {
  type: 'object',
  required: ['channel', 'post_at'],
  properties: {
    channel: { type: 'string', description: 'Channel id, user id, or #name' },
    post_at: { type: 'string', description: 'Unix time to post at' },
  },
};
const ADD_REACTION = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Emoji name' },
    timestamp: { type: 'string', description: 'Message ts' },
  },
};

function mockRegistry() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            connectors: [
              {
                name: 'slack',
                label: 'Slack',
                type: 'saas',
                origin: 'plugin',
                state: 'ready',
                actions: [
                  { key: 'chat.postMessage', label: 'Post Message', inputSchema: POST_MESSAGE },
                  { key: 'chat.scheduleMessage', label: 'Schedule Message', inputSchema: SCHEDULE_MESSAGE },
                  { key: 'reactions.add', label: 'Add Reaction', inputSchema: ADD_REACTION },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

const STORED_INPUT = { channel: 'C123', thread_ts: '111.222', legacy_note: 'keep me' };
/** `channel` bound to an expression, so a kept key is seen to keep its stored form, not only a value. */
const CHANNEL_BINDING = { dialect: 'cel', source: 'trigger.record.slack_channel' };

function makeDraft(connectorConfig: Record<string, unknown>) {
  return {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'post', type: 'connector_action', label: 'Post to Slack', connectorConfig },
    ],
    edges: [{ source: 'start', target: 'post' }],
  };
}

const SELECTION: MetadataSelection = { kind: 'node', id: 'post' };

/** Renders the inspector and re-renders it from each patch, as the designer does. */
function renderLive(initial: Record<string, unknown>) {
  let draft = initial;
  const onPatch = vi.fn();
  const view = (d: Record<string, unknown>) => (
    <FlowNodeInspector
      type="flow"
      name="notify_flow"
      selection={SELECTION}
      draft={d}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      locale="en-US"
      readOnly={false}
    />
  );
  const utils = render(view(draft));
  const apply = () => {
    const patch = onPatch.mock.calls.at(-1)![0] as Record<string, unknown>;
    draft = { ...draft, ...patch };
    utils.rerender(view(draft));
  };
  const savedConfig = () => {
    const node = ((draft.nodes ?? []) as Array<Record<string, unknown>>).find((n) => n.id === 'post')!;
    return node.connectorConfig as Record<string, unknown>;
  };
  return { onPatch, apply, savedConfig };
}

/** Type a new action name into the Action box, one commit, then re-render from the patch. */
function switchAction(live: ReturnType<typeof renderLive>, from: string, to: string) {
  fireEvent.change(screen.getByDisplayValue(from), { target: { value: to } });
  live.apply();
}

describe('#33346 row 254 — switching the action resets the Input map', () => {
  it('keeps the held inputs the new action declares, as they were, and drops the rest', async () => {
    mockRegistry();
    const live = renderLive(
      makeDraft({ connectorId: 'slack', actionId: 'chat.postMessage', input: { ...STORED_INPUT, channel: CHANNEL_BINDING } }),
    );
    expect(await screen.findByText('Channel')).toBeTruthy();

    switchAction(live, 'chat.postMessage', 'chat.scheduleMessage');

    const saved = live.savedConfig();
    expect(saved.actionId).toBe('chat.scheduleMessage');
    // `channel` is declared by both actions: its binding stays; `thread_ts` and
    // the undeclared `legacy_note` are not saved (so not sent).
    expect(saved.input).toEqual({ channel: CHANNEL_BINDING });
    expect(await screen.findByText('Unix time to post at')).toBeTruthy();
    expect(screen.queryByDisplayValue('111.222')).toBeNull();
    expect(screen.queryByDisplayValue('keep me')).toBeNull();
  });

  it('CONTROL — a new action that shares no key saves none of the previous inputs, and draws none', async () => {
    mockRegistry();
    const live = renderLive(makeDraft({ connectorId: 'slack', actionId: 'chat.postMessage', input: STORED_INPUT }));
    expect(await screen.findByText('Channel')).toBeTruthy();
    expect(screen.getByDisplayValue('keep me')).toBeTruthy();

    switchAction(live, 'chat.postMessage', 'reactions.add');

    const saved = live.savedConfig();
    expect(saved.actionId).toBe('reactions.add');
    // The saved (and so dispatched) map carries no key of the old action.
    expect(saved.input).toEqual({});
    // And the Input section draws the new action's fields with none of the old values.
    expect(await screen.findByText('Emoji name')).toBeTruthy();
    expect(screen.queryByDisplayValue('C123')).toBeNull();
    expect(screen.queryByDisplayValue('111.222')).toBeNull();
    expect(screen.queryByDisplayValue('keep me')).toBeNull();
  });

  it('a new connector resets the map the same way', async () => {
    mockRegistry();
    const live = renderLive(makeDraft({ connectorId: 'slack', actionId: 'chat.postMessage', input: STORED_INPUT }));
    expect(await screen.findByText('Channel')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('slack'), { target: { value: 'teams' } });
    live.apply();

    expect(live.savedConfig().connectorId).toBe('teams');
    expect(live.savedConfig().input).toEqual({});
  });

  it('an action with no known schema (mid-typing) gets an empty map; typing back gives the inputs back', async () => {
    mockRegistry();
    const live = renderLive(makeDraft({ connectorId: 'slack', actionId: 'chat.postMessage', input: STORED_INPUT }));
    expect(await screen.findByText('Channel')).toBeTruthy();

    // The box commits per keystroke: deleting the last letter is already a switch,
    // to an action the catalog does not know, so nothing is guessed through.
    switchAction(live, 'chat.postMessage', 'chat.postMessag');
    expect(live.savedConfig().input).toEqual({});
    switchAction(live, 'chat.postMessag', 'chat.postMessage');
    expect(live.savedConfig().input).toEqual(STORED_INPUT);
  });

  it('CONTROL — an edit that keeps the action keeps every stored input', async () => {
    mockRegistry();
    const live = renderLive(makeDraft({ connectorId: 'slack', actionId: 'chat.postMessage', input: STORED_INPUT }));
    expect(await screen.findByText('Channel')).toBeTruthy();

    // The typed Channel field, found through its label (the repeater draws the value too).
    const channel = screen.getByText('Channel').parentElement?.querySelector('input');
    fireEvent.change(channel!, { target: { value: 'C999' } });
    live.apply();

    expect(live.savedConfig().actionId).toBe('chat.postMessage');
    expect(live.savedConfig().input).toEqual({ channel: 'C999', thread_ts: '111.222', legacy_note: 'keep me' });
  });
});

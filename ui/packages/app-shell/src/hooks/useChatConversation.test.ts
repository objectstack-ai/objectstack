// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Hydration regression tests for the AI chat conversation loader.
 *
 * The server persists conversations in ModelMessage format: a tool CALL lives on
 * the assistant message, while its RESULT lives in a SEPARATE `tool`-role row.
 * Earlier `toUIMessages` dropped the `tool` row entirely, so the result (and the
 * ADR-0033 draft envelope it carries) was lost on reload — the build card +
 * Publish button vanished on refresh. These tests pin the fix: the result is
 * merged back onto the assistant tool-call part so the chat can rebuild the
 * draft affordances after a refresh.
 */
import { describe, it, expect } from 'vitest';
import { aiMessageRowsToServerMessages, toUIMessages } from './useChatConversation';

describe('toUIMessages — merging tool-results onto the call (refresh survival)', () => {
  const draftEnvelope = {
    status: 'drafted',
    drafted: [
      { type: 'object', name: 'expense' },
      { type: 'app', name: 'expense_tracker' },
    ],
    packageId: 'com.workspace',
    materialized: true,
  };

  const rows = [
    { id: 'u1', role: 'user', content: 'build an expense tracker' },
    {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll build it." },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'apply_blueprint', input: { blueprint: {} } },
      ],
    },
    {
      id: 't1',
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'apply_blueprint', output: draftEnvelope }],
    },
    { id: 'a2', role: 'assistant', content: 'Done!' },
  ];

  it('drops the standalone tool row but merges its output onto the assistant call part', () => {
    const out = toUIMessages(rows as never);
    // user, assistant(call), assistant(done) — the `tool` row is not rendered.
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    const callPart = out[1].parts.find((p) => p.toolCallId === 'call_1');
    expect(callPart).toBeDefined();
    expect((callPart as { output?: unknown }).output).toEqual(draftEnvelope);
    // a finished result terminalizes the call so the chip never reads "Running".
    expect((callPart as { state?: string }).state).toBe('output-available');
  });

  it('marks the call output-error when the tool result reports an error', () => {
    const errRows = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c_err', toolName: 'add_field', input: {} }],
      },
      {
        id: 't1',
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c_err', toolName: 'add_field', output: { ok: false }, errorText: 'boom' },
        ],
      },
    ];
    const out = toUIMessages(errRows as never);
    const callPart = out[0].parts.find((p) => p.toolCallId === 'c_err');
    expect((callPart as { state?: string }).state).toBe('output-error');
    expect((callPart as { errorText?: string }).errorText).toBe('boom');
  });

  it('leaves messages without tool results untouched', () => {
    const plain = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'hello' },
    ];
    const out = toUIMessages(plain as never);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(out[1].parts).toEqual([{ type: 'text', text: 'hello' }]);
  });
});

/**
 * objectui#9233 — `mergeToolResultsInto` used to overwrite the part's `state`
 * unconditionally on every merge, so a rehydrated pending approval reached the
 * chat as Completed and the awaiting-approval card (gated on
 * `state === 'approval-requested'` in `ChatbotEnhanced`) never rendered on this
 * sub-path. The rewrite itself is load-bearing and stays — the tests at the end
 * of this block pin that half. What must not happen is an APPROVAL state being
 * rewritten by it.
 */
describe('toUIMessages — a merged result must not rewrite an approval state (objectui#9233)', () => {
  const pendingValue = JSON.stringify({
    status: 'pending_approval',
    pendingActionId: 'pa_44',
    toolName: 'action_delete_task',
  });
  /** The shape the server really persists for a tool result on this path. */
  const pendingEnvelope = { type: 'text', value: pendingValue };

  function rowsFor(
    callPart: Record<string, unknown>,
    resultPart: Record<string, unknown>,
  ) {
    return [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'This needs your approval.' }, callPart],
      },
      { id: 't1', role: 'tool', content: [resultPart] },
    ];
  }

  function mergedCallPart(
    callPart: Record<string, unknown>,
    resultPart: Record<string, unknown>,
  ) {
    const out = toUIMessages(rowsFor(callPart, resultPart) as never);
    return out[0].parts.find((p) => p.toolCallId === 'c1') as
      | { state?: string; output?: unknown; errorText?: string }
      | undefined;
  }

  it('promotes a merged pending-approval result to approval-requested', () => {
    // The ModelMessage sub-path in full: the assistant row persists a bare
    // `tool-call` with NO state, the RESULT arrives on a separate `tool` row.
    // Merging used to write `output-available` here, which is terminal — and a
    // terminal state is exactly what `partToolState` passes through, so the
    // approval was unrecoverable by the time the mapper ran.
    const part = mergedCallPart(
      { type: 'tool-call', toolCallId: 'c1', toolName: 'action_delete_task', input: {} },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        output: pendingEnvelope,
      },
    );
    expect(part?.state).toBe('approval-requested');
    // The output is still merged — the fix narrows the STATE rewrite only.
    expect(part?.output).toEqual(pendingEnvelope);
  });

  it('promotes an unwrapped pending envelope too', () => {
    const part = mergedCallPart(
      { type: 'tool-call', toolCallId: 'c1', toolName: 'action_delete_task', input: {} },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        output: { status: 'pending_approval', pendingActionId: 'pa_45' },
      },
    );
    expect(part?.state).toBe('approval-requested');
  });

  it('leaves a part that ALREADY declares an approval state alone', () => {
    // Assistant rows are not always ModelMessage `tool-call` entries:
    // `contentToParts` passes a persisted UIMessage part through verbatim, so a
    // part can arrive already carrying the approval state the server snapshotted.
    // A later `tool` row must not overwrite it either.
    const responded = mergedCallPart(
      {
        type: 'tool-action_delete_task',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        state: 'approval-responded',
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        output: { ok: true },
      },
    );
    expect(responded?.state).toBe('approval-responded');

    const requested = mergedCallPart(
      {
        type: 'tool-action_delete_task',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        state: 'approval-requested',
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        output: { ok: true },
      },
    );
    expect(requested?.state).toBe('approval-requested');
  });

  it('still lets an ERROR result win over a pending envelope', () => {
    // Mirrors the live mapper's `baseState !== 'output-error'` guard: a failed
    // call is not awaiting anybody, and rendering Approve / Reject over it would
    // offer a decision that cannot be carried out.
    const part = mergedCallPart(
      { type: 'tool-call', toolCallId: 'c1', toolName: 'action_delete_task', input: {} },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'action_delete_task',
        output: pendingEnvelope,
        errorText: 'boom',
      },
    );
    expect(part?.state).toBe('output-error');
    expect(part?.errorText).toBe('boom');
  });

  it('STILL collapses a dangling input state when the result is ordinary', () => {
    // The load-bearing half, pinned so the narrowing above cannot widen into
    // "stop rewriting the state": without this collapse a reloaded conversation
    // shows every tool "Running" forever.
    const part = mergedCallPart(
      {
        type: 'tool-add_field',
        toolCallId: 'c1',
        toolName: 'add_field',
        state: 'input-streaming',
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'add_field',
        output: { status: 'drafted', drafted: [] },
      },
    );
    expect(part?.state).toBe('output-available');
  });
});

describe('aiMessageRowsToServerMessages — flat share rows → ModelMessage shape', () => {
  // The public share endpoint (`/s/:token/messages`) returns the raw, FLAT
  // `ai_messages` columns: an assistant turn's tool CALLS sit in a separate
  // `tool_calls` column, and a `tool` row's RESULTS are a JSON-stringified
  // array in `content`. Mirrors `ObjqlConversationService.toMessage`.
  it('lifts assistant tool_calls into a content array alongside the text', () => {
    const [msg] = aiMessageRowsToServerMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: 'I will build it.',
        tool_calls: JSON.stringify([
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'propose_blueprint', input: {} },
        ]),
      },
    ]);
    expect(msg.content).toEqual([
      { type: 'text', text: 'I will build it.' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'propose_blueprint', input: {} },
    ]);
  });

  it('parses a stringified tool-result array back into structured content', () => {
    const result = {
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'propose_blueprint',
      output: { type: 'text', value: '{"status":"blueprint_proposed"}' },
    };
    const [msg] = aiMessageRowsToServerMessages([
      { id: 't1', role: 'tool', tool_call_id: 'call_1', content: JSON.stringify([result]) },
    ]);
    expect(msg.content).toEqual([result]);
  });

  it('reconstructs the FULL flat transcript so toUIMessages recovers the tool output', () => {
    // The end-to-end share path: flat rows → ModelMessage shape → hydrate. The
    // tool RESULT must land back on the assistant CALL part, or the shared
    // transcript loses its proposed-plan / draft card (the original bug).
    const envelope = { type: 'text', value: '{"status":"blueprint_proposed"}' };
    const rows = aiMessageRowsToServerMessages([
      { id: 'u1', role: 'user', content: '帮我开发一个mes' },
      {
        id: 'a1',
        role: 'assistant',
        content: '我来帮您开发一个MES。',
        tool_calls: JSON.stringify([
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'propose_blueprint', input: {} },
        ]),
      },
      {
        id: 't1',
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify([
          { type: 'tool-result', toolCallId: 'call_1', toolName: 'propose_blueprint', output: envelope },
        ]),
      },
    ]);
    const out = toUIMessages(rows);
    // The `tool` row is merged away — user + assistant only.
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
    const callPart = out[1].parts.find((p) => p.toolCallId === 'call_1');
    expect((callPart as { output?: unknown }).output).toEqual(envelope);
    expect((callPart as { state?: string }).state).toBe('output-available');
  });

  it('falls back to a synthetic tool-result for legacy plain-string tool rows', () => {
    const [msg] = aiMessageRowsToServerMessages([
      { id: 't1', role: 'tool', tool_call_id: 'call_9', content: 'plain old string output' },
    ]);
    expect(msg.content).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call_9',
        toolName: 'unknown',
        output: { type: 'text', value: 'plain old string output' },
      },
    ]);
  });
});

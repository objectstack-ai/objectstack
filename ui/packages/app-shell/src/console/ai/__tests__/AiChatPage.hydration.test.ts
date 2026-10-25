// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import {
  aiMessageRowsToServerMessages,
  toUIMessages,
  type HydratedUIMessage,
} from '../../../hooks/useChatConversation';

function assistantWith(parts: HydratedUIMessage['parts']): HydratedUIMessage[] {
  return [{ id: 'm1', role: 'assistant', parts }];
}

describe('AiChatPage hydration — tool invocation states', () => {
  it('promotes STATELESS tool parts to output-available (server ModelMessage tool-call entries)', () => {
    // Server conversations persist ModelMessage content: `tool-call` entries
    // carry toolName/toolCallId but NO UI state. Hydrated history has ended,
    // so stateless must render Completed — not an eternal "Running" chip.
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        { type: 'tool-call', toolCallId: 't1', toolName: 'propose_blueprint' },
      ]),
    );
    expect(msg.toolInvocations).toEqual([
      { toolCallId: 't1', toolName: 'propose_blueprint', state: 'output-available' },
    ]);
  });

  it('promotes dangling mid-stream states to output-available', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        { type: 'tool-add_field', toolCallId: 't1', toolName: 'add_field', state: 'input-available' },
        { type: 'tool-create_metadata', toolCallId: 't2', toolName: 'create_metadata', state: 'input-streaming' },
      ]),
    );
    expect(msg.toolInvocations?.map((t) => t.state)).toEqual(['output-available', 'output-available']);
  });

  it('preserves genuine terminal states', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        { type: 'tool-add_field', toolCallId: 't1', toolName: 'add_field', state: 'output-error', errorText: 'boom' },
        { type: 'tool-verify_build', toolCallId: 't2', toolName: 'verify_build', state: 'output-denied' },
      ]),
    );
    expect(msg.toolInvocations).toEqual([
      { toolCallId: 't1', toolName: 'add_field', state: 'output-error', errorText: 'boom' },
      { toolCallId: 't2', toolName: 'verify_build', state: 'output-denied' },
    ]);
  });

  it('lifts the pre-build proposed plan so the review card survives a reload on this surface', () => {
    // propose_blueprint's `blueprint_proposed` result rides the merged tool
    // output (here the persisted `{type:text,value}` envelope). Without lifting
    // it on THIS converter the "Proposed plan" card only shows in the floating
    // chat, never on /ai/build after a refresh.
    const envelope = JSON.stringify({
      status: 'blueprint_proposed',
      blueprint: {
        summary: 'A reading list',
        assumptions: ['One shelf for now'],
        objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }, { name: 'author' }] }],
      },
      counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
      questions: [],
    });
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'propose_blueprint',
          output: { type: 'text', value: envelope },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]?.proposedPlan).toMatchObject({
      summary: 'A reading list',
      objects: [{ name: 'book', label: 'Book', fieldCount: 2 }],
      assumptions: ['One shelf for now'],
    });
  });

  it('lifts the ask-decline builder handoff so the "Open in Builder →" card survives a reload', () => {
    // The `ask` agent's structured decline (suggest_builder → build_handoff)
    // rides the merged tool output. Without lifting it on THIS converter the
    // handoff card only shows in the live floating chat and is LOST when the
    // conversation is reloaded or restored from the sessionStorage cache.
    const envelope = JSON.stringify({
      status: 'build_handoff',
      handoff: 'build',
      prompt: 'Build a CRM to track leads',
      packageId: 'app.crm',
    });
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'suggest_builder',
          output: { type: 'text', value: envelope },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]?.builderHandoff).toEqual({
      prompt: 'Build a CRM to track leads',
      packageId: 'app.crm',
    });
  });
});

describe('shared-conversation render — flat ai_messages rows → proposed-plan card', () => {
  // Reproduces the public `/s/:token` share bug: the endpoint returns FLAT
  // `ai_messages` rows, which the read-only page must put through the SAME
  // hydrate pipeline as the live chat. Before the fix it dumped the raw
  // `{"type":"tool-result",…}` envelope as text; this pins that the full
  // raw-rows → ServerMessage → toUIMessages → map chain yields the card.
  it('recovers the Proposed plan card from the raw shared rows', () => {
    const envelope = JSON.stringify({
      status: 'blueprint_proposed',
      blueprint: {
        summary: 'A simple MES',
        assumptions: ['Single production line'],
        objects: [{ name: 'work_order', label: '工单', fields: [{ name: 'no' }, { name: 'qty' }] }],
      },
      counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
      questions: [],
    });
    const chat = hydratedMessagesToChatMessages(
      toUIMessages(
        aiMessageRowsToServerMessages([
          { id: 'u1', role: 'user', content: '帮我开发一个mes' },
          {
            id: 'a1',
            role: 'assistant',
            content: '我来帮您开发一个MES。',
            tool_calls: JSON.stringify([
              { type: 'tool-call', toolCallId: 'c1', toolName: 'propose_blueprint', input: {} },
            ]),
          },
          {
            id: 't1',
            role: 'tool',
            tool_call_id: 'c1',
            content: JSON.stringify([
              { type: 'tool-result', toolCallId: 'c1', toolName: 'propose_blueprint', output: { type: 'text', value: envelope } },
            ]),
          },
        ]),
      ),
    );
    // No standalone tool message leaks into the transcript.
    expect(chat.map((m) => m.role)).toEqual(['user', 'assistant']);
    const assistant = chat[1];
    expect(assistant.content).toBe('我来帮您开发一个MES。');
    expect(assistant.toolInvocations?.[0]?.proposedPlan).toMatchObject({
      summary: 'A simple MES',
      objects: [{ name: 'work_order', label: '工单', fieldCount: 2 }],
      assumptions: ['Single production line'],
    });
  });
});

describe('AiChatPage hydration — the approval envelope and the pending-action id (objectui#8442)', () => {
  // The mapper used to build an invocation from six things and neither of these
  // was one of them, so a rehydrated pending approval arrived carrying a state
  // that says "a human must decide" and nothing a decision could be made WITH.
  //
  // The two halves arrive from different places, which is why they are pinned
  // separately: the AI SDK's `approval` envelope is persisted ON THE PART, and
  // the ObjectStack `pendingActionId` lives only inside the tool RESULT — it is
  // never a part key — so it is derived by the same detector the live mapper
  // (`mapMessages.extractToolInvocations`) uses.

  it('carries the AI SDK approval envelope persisted on the part', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-action_delete_task',
          toolCallId: 't1',
          toolName: 'action_delete_task',
          state: 'approval-requested',
          approval: { id: 'apr_1', isAutomatic: false },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'apr_1', isAutomatic: false },
    });
  });

  it('keeps every declared member of a full envelope and drops nothing declared', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-action_delete_task',
          toolCallId: 't1',
          toolName: 'action_delete_task',
          state: 'approval-responded',
          approval: {
            id: 'apr_2',
            approved: true,
            reason: 'operator confirmed',
            isAutomatic: false,
            signature: 'sig_abc',
          },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]?.approval).toEqual({
      id: 'apr_2',
      approved: true,
      reason: 'operator confirmed',
      isAutomatic: false,
      signature: 'sig_abc',
    });
  });

  it('REFUSES an envelope with no usable id rather than passing the shape through', () => {
    // `HydratedUIMessagePart` is an open record: whatever the server wrote is
    // reachable and UNVERIFIED. An `approval` without an `id` cannot be replied
    // on, so carrying it would hand the UI a half-envelope to guess at.
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        { type: 'tool-x', toolCallId: 't1', toolName: 'x', approval: { approved: true } },
        { type: 'tool-y', toolCallId: 't2', toolName: 'y', approval: 'apr_3' },
        { type: 'tool-z', toolCallId: 't3', toolName: 'z', approval: { id: '' } },
      ]),
    );
    expect(msg.toolInvocations?.map((t) => t.approval)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('lifts pendingActionId out of the persisted HITL result envelope', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'action_delete_task',
          output: { status: 'pending_approval', pendingActionId: 'pa_42' },
        },
      ]),
    );
    // Without this the invocation reaches `useHitlInChat` un-indexed — the hook
    // keys its map on `pendingActionId` and skips any invocation without one,
    // so Approve / Reject has no id to POST.
    expect(msg.toolInvocations?.[0]?.pendingActionId).toBe('pa_42');
  });

  it('lifts it through the persisted {type:text,value} wrapper too', () => {
    // The shape the server really persists for a tool result on this path.
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'action_delete_task',
          output: {
            type: 'text',
            value: JSON.stringify({ status: 'pending_approval', pendingActionId: 'pa_43' }),
          },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]?.pendingActionId).toBe('pa_43');
  });

  it('leaves pendingActionId absent when the result is not a HITL proposal', () => {
    const [msg] = hydratedMessagesToChatMessages(
      assistantWith([
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'verify_build',
          output: { status: 'ok' },
        },
      ]),
    );
    expect(msg.toolInvocations?.[0]?.pendingActionId).toBeUndefined();
    expect('pendingActionId' in (msg.toolInvocations?.[0] ?? {})).toBe(false);
  });

  it('lifts it through the full ModelMessage round trip (call row + separate tool-result row)', () => {
    // The server-backed shape: the CALL and its RESULT are different rows, and
    // `toUIMessages` merges the result onto the call part.
    const chat = hydratedMessagesToChatMessages(
      toUIMessages(
        aiMessageRowsToServerMessages([
          { id: 'u1', role: 'user', content: 'delete the task' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'This needs your approval.',
            tool_calls: JSON.stringify([
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'action_delete_task',
                input: {},
              },
            ]),
          },
          {
            id: 't1',
            role: 'tool',
            tool_call_id: 'c1',
            content: JSON.stringify([
              {
                type: 'tool-result',
                toolCallId: 'c1',
                toolName: 'action_delete_task',
                output: {
                  type: 'text',
                  value: JSON.stringify({
                    status: 'pending_approval',
                    pendingActionId: 'pa_44',
                  }),
                },
              },
            ]),
          },
        ]),
      ),
    );
    const tool = chat[1]?.toolInvocations?.[0];
    expect(tool?.pendingActionId).toBe('pa_44');
    // TURNED OVER by objectui#9233, in place and deliberately: this line used
    // to assert `output-available` — not because that was right, but because it
    // was what the pipeline DID. objectui#8442 pinned the defective reading
    // rather than describing it, precisely so the card that fixed it would meet
    // a red line here instead of a stale sentence. This is that red line, paid.
    //
    // What changed: `mergeToolResultsInto` (useChatConversation.ts) no longer
    // overwrites the state when the merged result carries the HITL pending
    // envelope — it promotes to `approval-requested`, exactly as the live mapper
    // (`mapMessages.extractToolInvocations`) already did. So both halves of an
    // actionable approval now survive the ModelMessage sub-path: the id the hook
    // indexes on, and the state `ChatbotEnhanced`'s `isAwaitingApproval` gate
    // reads. The operator gets a real Approve / Reject card after a reload.
    expect(tool?.state).toBe('approval-requested');
  });
});

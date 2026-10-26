/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#25887 — a whole-app build that ran as a confirm-replay (the
 * approved `apply_blueprint`, re-dispatched under a `replay_` tool-call id)
 * keeps its build on both reload paths.
 *
 *  - Server history: raw rows → `toUIMessages` → `hydratedMessagesToChatMessages`
 *    → the tool part `useObjectChat` rebuilds (`output: tool.result`) → the
 *    live mapper. The stored envelope reaches the mapper whole; the hydrated
 *    mapper must keep the draft review so the thread binds to the package it
 *    built, and the live mapper must draw the done tree.
 *  - Cache fallback: live map → `sanitizeChatMessagesForCache` → JSON → re-map.
 *    The bare replay verdict carries no `drafted[]`, so caching it alone lost
 *    the build.
 *
 * The envelope is the producer's `apply_blueprint` answer as the card
 * records it; the producer lives outside this repository.
 */
import { describe, it, expect } from 'vitest';
import { uiMessageToChatMessage } from '@object-ui/plugin-chatbot';
import { deriveBoundPackageId, hydratedMessagesToChatMessages } from '../../console/ai/AiChatPage';
import {
  aiMessageRowsToServerMessages,
  sanitizeChatMessagesForCache,
  toUIMessages,
} from '../useChatConversation';

const REPLAY_ID = 'replay_BFpdNra4mJHv5BMH_0';

const buildEnvelope = {
  status: 'drafted',
  packageId: 'app.z1a4',
  drafted: [
    { type: 'app', name: 'z1a4_app' },
    { type: 'object', name: 'z1a4_task' },
  ],
  autoPublishable: true,
  nextSteps: ['Add a due date to tasks'],
};

/** The stored conversation: the approval turn, then the replayed build. */
function serverHistory(envelope: object) {
  return toUIMessages(
    aiMessageRowsToServerMessages([
      { id: 'u1', role: 'user', content: 'Looks good — build it as proposed.' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Built.',
        tool_calls: JSON.stringify([
          { type: 'tool-call', toolCallId: REPLAY_ID, toolName: 'apply_blueprint', input: {} },
        ]),
      },
      {
        id: 't1',
        role: 'tool',
        tool_call_id: REPLAY_ID,
        content: JSON.stringify([
          {
            type: 'tool-result',
            toolCallId: REPLAY_ID,
            toolName: 'apply_blueprint',
            output: { type: 'json', value: envelope },
          },
        ]),
      },
    ]),
  );
}

/** What `useObjectChat` hands the live mapper for a hydrated invocation. */
function rerendered(chat: ReturnType<typeof hydratedMessagesToChatMessages>[number]) {
  return uiMessageToChatMessage({
    id: chat.id,
    role: chat.role,
    parts: (chat.toolInvocations ?? []).map((tool) => ({
      type: `tool-${tool.toolName}`,
      toolCallId: tool.toolCallId,
      state: 'output-available',
      input: {},
      output: tool.result,
    })),
  });
}

describe('server history — a replayed build reloads as a build (objectstack#25887)', () => {
  it('keeps the draft review, binds the thread to the built package, and draws the done tree', () => {
    const chat = hydratedMessagesToChatMessages(serverHistory(buildEnvelope));
    const assistant = chat.find((m) => m.role === 'assistant')!;
    const tool = assistant.toolInvocations?.[0];
    expect(tool?.replayOutcome).toMatchObject({ kind: 'drafted', packageId: 'app.z1a4' });
    expect(tool?.draftReview).toMatchObject({ packageId: 'app.z1a4', nextSteps: ['Add a due date to tasks'] });
    expect(deriveBoundPackageId(chat, undefined)).toBe('app.z1a4');

    const live = rerendered(assistant);
    expect(live.toolInvocations?.[0]?.draftReview).toMatchObject({ packageId: 'app.z1a4' });
    expect(live.buildProgress).toMatchObject({ phase: 'done', appLabel: 'Z1a4 App' });
  });

  it('control: a replay whose publish rolled back still lifts no draft review and binds nothing', () => {
    const chat = hydratedMessagesToChatMessages(
      serverHistory({ ...buildEnvelope, publishFailed: true, publishOutcome: 'rolled_back' }),
    );
    const tool = chat.find((m) => m.role === 'assistant')!.toolInvocations?.[0];
    expect(tool?.replayOutcome).toMatchObject({ kind: 'failed' });
    expect(tool?.draftReview).toBeUndefined();
    expect(deriveBoundPackageId(chat, undefined)).toBeUndefined();
  });
});

describe('cache fallback — a replayed build survives the round trip (objectstack#25887)', () => {
  const cachedReload = (envelope: object) => {
    const live = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Built.' },
        { type: 'tool-apply_blueprint', toolCallId: REPLAY_ID, state: 'output-available', input: {}, output: envelope },
      ],
    });
    const persisted = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([live]))) as ReturnType<
      typeof sanitizeChatMessagesForCache
    >;
    return uiMessageToChatMessage(persisted[0]);
  };

  it('a drafted whole-app replay caches its draft envelope: verdict, review and tree all come back', () => {
    const reloaded = cachedReload(buildEnvelope);
    const tool = reloaded.toolInvocations?.[0];
    expect(tool?.replayOutcome).toMatchObject({ kind: 'drafted', packageId: 'app.z1a4' });
    expect(tool?.draftReview).toMatchObject({ packageId: 'app.z1a4', nextSteps: ['Add a due date to tasks'] });
    expect(reloaded.buildProgress).toMatchObject({ phase: 'done', appLabel: 'Z1a4 App' });
  });

  it('control: a failed replay still caches the bare verdict, so it never comes back as a draft card', () => {
    const reloaded = cachedReload({ ...buildEnvelope, publishFailed: true, publishOutcome: 'rolled_back' });
    const tool = reloaded.toolInvocations?.[0];
    expect(tool?.replayOutcome).toMatchObject({ kind: 'failed', outcome: 'rolled_back' });
    expect(tool?.draftReview).toBeUndefined();
    expect(reloaded.buildProgress).toBeUndefined();
  });
});

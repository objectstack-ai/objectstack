/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `extractToolInvocations` lifts the chat runtime's `approval` envelope
 * (objectui#8426, the clause assigned to this card when objectui#8442 shipped
 * as the additive half).
 *
 * ## Why the lift had to wait for a reader
 *
 * The envelope had NO reader until the parts builder in `useObjectChat.ts`
 * started constructing the discriminated arms, and a declared-but-unread key on
 * a chat surface is the defect class this repo keeps carding. So the lift lands
 * in the same round as its read site — and until it did, the two paths into the
 * same conversation disagreed: the HYDRATED path (`hydratedMessagesToChatMessages`,
 * objectui#8442) carried `approval`, the LIVE path here dropped it.
 *
 * ⚠️ `approval` and `pendingActionId` are NOT the same thing and neither
 * replaces the other: the first is the runtime's own request id, the second is
 * the ObjectStack `pending_actions` row the approve/reject endpoints take. The
 * last test below pins that they ride together.
 */

import { describe, it, expect } from 'vitest';
import { uiMessageToChatMessage } from '../mapMessages';

describe('extractToolInvocations lifts the approval envelope', () => {
  it('carries id, decision, reason and the provider flags', () => {
    const out = uiMessageToChatMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-drop_table',
          toolCallId: 'c1',
          state: 'approval-responded',
          input: { table: 't' },
          approval: {
            id: 'apr_1',
            approved: false,
            reason: 'too risky',
            isAutomatic: true,
            signature: 'sig',
          },
        },
      ],
    } as never);

    expect(out.toolInvocations?.[0]).toMatchObject({
      toolName: 'drop_table',
      state: 'approval-responded',
      approval: {
        id: 'apr_1',
        approved: false,
        reason: 'too risky',
        isAutomatic: true,
        signature: 'sig',
      },
    });
  });

  it('LIT CONTROL — a part with no envelope yields no envelope', () => {
    // Without this, a lift that hard-coded an object would satisfy the test
    // above. An invented `approval.id` is precisely the fabrication the
    // contract-first rule forbids.
    const out = uiMessageToChatMessage({
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'tool-search', toolCallId: 'c2', state: 'output-available', output: { hits: 0 } },
      ],
    } as never);

    expect(out.toolInvocations?.[0]?.approval).toBeUndefined();
  });

  it('refuses an envelope whose id cannot be replied on', () => {
    // `id` is required by the output contract. An envelope without a usable one
    // is not an envelope — lifting it would hand a chat surface an approval it
    // can never answer.
    for (const approval of [{}, { id: '' }, { id: 42 }, { approved: true }, 'apr_1', null]) {
      const out = uiMessageToChatMessage({
        id: 'm3',
        role: 'assistant',
        parts: [
          { type: 'tool-x', toolCallId: 'c3', state: 'approval-requested', input: {}, approval },
        ],
      } as never);
      expect(out.toolInvocations?.[0]?.approval).toBeUndefined();
    }
  });

  it('drops a member a producer got wrong, and keeps the rest', () => {
    // `AnyPart.approval` is `unknown` — the input interface absorbs whatever
    // arrives, and this lift is the thing that keeps the OUTPUT checked. The
    // `id` is what makes an approval answerable, so a bad sibling member costs
    // that member and not the envelope.
    const out = uiMessageToChatMessage({
      id: 'm3b',
      role: 'assistant',
      parts: [
        {
          type: 'tool-x',
          toolCallId: 'c3b',
          state: 'approval-responded',
          input: {},
          approval: { id: 'apr_x', approved: 'yes', reason: 7, isAutomatic: true },
        },
      ],
    } as never);

    expect(out.toolInvocations?.[0]?.approval).toEqual({
      id: 'apr_x',
      approved: undefined,
      reason: undefined,
      isAutomatic: true,
      signature: undefined,
    });
  });

  it('rides ALONGSIDE pendingActionId rather than replacing it', () => {
    const out = uiMessageToChatMessage({
      id: 'm4',
      role: 'assistant',
      parts: [
        {
          type: 'tool-delete_records',
          toolCallId: 'c4',
          state: 'approval-requested',
          input: { id: 'r1' },
          output: { status: 'pending_approval', pendingActionId: 'pa_9' },
          approval: { id: 'apr_9' },
        },
      ],
    } as never);

    expect(out.toolInvocations?.[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'apr_9' },
      pendingActionId: 'pa_9',
    });
  });
});

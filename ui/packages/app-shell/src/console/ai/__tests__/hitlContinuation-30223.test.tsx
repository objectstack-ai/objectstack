// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30223 — the follow-up turn the chat sends the model after
 * 确认 / 取消 is stored as an ordinary user message (the store keeps only the
 * text). A reloaded conversation must not draw it as the person's bubble, and
 * the conversation-language probe must not read it as the person's latest turn.
 *
 * The reload leg drives the real hydration path over stored rows, exactly as
 * `recordWriteRehydration-3565` does, then draws the result with the real
 * `ChatbotEnhanced`.
 */

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatbotEnhanced } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import { detectConversationLanguage } from '../conversationLanguage';
import {
  aiMessageRowsToServerMessages,
  toUIMessages,
  type RawAiMessageRow,
} from '../../../hooks/useChatConversation';

const ASK = '把这条状态改成 Active';
const CONTINUATION =
  '[HITL pa_8cf40802-901e-44ae-9610-bcaac8935d3b] The operator approved the `update_record` call. ' +
  'It executed successfully with result: {"status":"written","operation":"update","recordId":"vhGuAdkNThenRvKh"}. ' +
  "Acknowledge the outcome concisely and continue the user's task.";
const FOLLOW_UP = 'Also set the owner to Li Lei';

function storedRows(extra: RawAiMessageRow[] = []): RawAiMessageRow[] {
  return [
    { id: 'u1', role: 'user', content: ASK },
    {
      id: 'a1',
      role: 'assistant',
      content: '请在上方卡片确认。',
      tool_calls: JSON.stringify([
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'update_record',
          input: { objectName: 'jpph_customer', recordId: 'vhGuAdkNThenRvKh', values: { status: 'Active' } },
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
          toolName: 'update_record',
          output: {
            type: 'text',
            value: JSON.stringify({ status: 'pending_approval', pendingActionId: 'pa_8cf40802-901e-44ae-9610-bcaac8935d3b' }),
          },
        },
      ]),
    },
    { id: 'u2', role: 'user', content: CONTINUATION },
    { id: 'a2', role: 'assistant', content: '已将验收客户 R2 的状态改为 Active。' },
    ...extra,
  ];
}

function reload(rows: RawAiMessageRow[]) {
  return hydratedMessagesToChatMessages(toUIMessages(aiMessageRowsToServerMessages(rows)));
}

describe('a reloaded conversation hides the HITL continuation (objectstack#30223)', () => {
  it('hydrates the stored continuation and draws no bubble for it', () => {
    const messages = reload(storedRows());
    // Stored, and hydrated as a user message: the store has no other channel.
    expect(messages.some((m) => m.role === 'user' && m.content === CONTINUATION)).toBe(true);

    render(<ChatbotEnhanced messages={messages} />);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(screen.getByText('已将验收客户 R2 的状态改为 Active。')).toBeInTheDocument();
    expect(screen.queryByText(/The operator approved/)).toBeNull();
    expect(screen.queryByText(/\[HITL /)).toBeNull();
  });

  it('CONTROL: an ordinary stored user message still draws as the person\'s bubble', () => {
    render(
      <ChatbotEnhanced
        messages={reload(storedRows([{ id: 'u3', role: 'user', content: FOLLOW_UP }]))}
      />,
    );
    expect(screen.getByText(FOLLOW_UP)).toBeInTheDocument();
    expect(screen.getByText(ASK)).toBeInTheDocument();
  });
});

describe('the conversation-language probe reads past the HITL continuation (objectstack#30223)', () => {
  it('a Chinese conversation stays Chinese after an English continuation', () => {
    expect(
      detectConversationLanguage([
        { role: 'user', content: ASK },
        { role: 'assistant', content: '请确认。' },
        { role: 'user', content: CONTINUATION },
      ]),
    ).toBe('zh-CN');
  });

  it('CONTROL: an English turn the person typed still decides the language', () => {
    expect(
      detectConversationLanguage([
        { role: 'user', content: ASK },
        { role: 'user', content: FOLLOW_UP },
      ]),
    ).toBeUndefined();
  });
});

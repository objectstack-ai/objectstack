// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#3565 — a record-write card survives a reload with everything the
 * three buttons need: the pending id (for 确认 / 取消 through `useHitlInChat`),
 * the `approval-requested` state (the render gate) and the record itself (what
 * the card draws, and what 打开完整表单 hands the form). The server persists
 * the proposal split across an assistant row and a tool row; this drives the
 * real hydration path over those rows.
 */

import { describe, expect, it } from 'vitest';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import {
  aiMessageRowsToServerMessages,
  toUIMessages,
} from '../../../hooks/useChatConversation';

const PROPOSED = {
  success: true,
  status: 'pending_approval',
  pendingActionId: 'pa_91',
  recordWrite: {
    operation: 'update',
    objectName: 'crm_lead',
    objectLabel: '线索',
    recordId: 'lead_zhangwei',
    label: '张伟',
    fields: [{ name: 'status', label: '状态', type: 'select', value: 'contacted', current: 'new' }],
    dropped: [],
    fieldSecurity: 'record_projection',
  },
};

function hydrateServerRows() {
  return hydratedMessagesToChatMessages(
    toUIMessages(
      aiMessageRowsToServerMessages([
        { id: 'u1', role: 'user', content: '把张伟的状态改成已联系' },
        {
          id: 'a1',
          role: 'assistant',
          content: '请在上方卡片确认。',
          tool_calls: JSON.stringify([
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'update_record',
              input: { objectName: 'crm_lead', recordId: 'lead_zhangwei', values: { status: '已联系' } },
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
              output: { type: 'text', value: JSON.stringify(PROPOSED) },
            },
          ]),
        },
      ]),
    ),
  );
}

describe('a rehydrated record-write card is complete (cloud#3565)', () => {
  it('hydrates to approval-requested with the pending id and the record', () => {
    const messages = hydrateServerRows();
    const tool = messages[1]?.toolInvocations?.[0];
    expect(tool?.toolName).toBe('update_record');
    expect(tool?.state).toBe('approval-requested');
    expect(tool?.pendingActionId).toBe('pa_91');
    expect(tool?.recordWrite).toEqual({
      operation: 'update',
      objectName: 'crm_lead',
      objectLabel: '线索',
      recordId: 'lead_zhangwei',
      label: '张伟',
      fields: [{ name: 'status', label: '状态', type: 'select', value: 'contacted', current: 'new' }],
      dropped: [],
    });
  });
});

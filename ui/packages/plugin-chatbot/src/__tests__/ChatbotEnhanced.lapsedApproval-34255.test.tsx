/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The chat's inline approval card reads a LAPSED pending action as "Expired"
 * (objectstack#34255, the console half of the ruling on cloud#4608).
 *
 * The card learns of a lapse from the decision it sends: the server answers
 * `409` with `error.details.reason: 'pending_action_lapsed'`. Before this, the
 * card drew the generic failure ("Approval failed: HTTP 409") in the error
 * style, as if something were broken. The hook and the card are run together,
 * through the real button, so the assertion is what a person sees. A person's
 * own rejection still reads as a rejection.
 *
 * Rendered in zh: 已过期 comes only from the pack.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ToolDecisionState } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';
import { useHitlInChat } from '../useHitlInChat';

const ZH_EXPIRED = '已过期';
const ZH_EXPIRED_DETAIL = '没有在期限内处理，或发起人已失去访问权限。';

function transcript(result: unknown, toolName = 'action_delete_task') {
  return uiMessagesToChatMessages([
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: `tool-${toolName}`,
          toolCallId: 'c1',
          state: 'output-available',
          input: { id: 't1' },
          output: { type: 'text', value: JSON.stringify(result) },
        },
      ],
    },
  ]);
}

const PENDING = { status: 'pending_approval', pendingActionId: 'pa_1', message: 'Needs approval' };

function Harness({ onDecided }: { onDecided?: (id: string, outcome: unknown) => void }) {
  const messages = React.useMemo(() => transcript(PENDING), []);
  const hitl = useHitlInChat({ messages, onDecided });
  return (
    <ChatbotEnhanced
      messages={messages}
      onSendMessage={vi.fn()}
      onToolApprove={hitl.decide}
      toolDecisions={hitl.decisions}
      toolApproveLabel="APPROVE"
      toolDenyLabel="DENY"
    />
  );
}

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

function renderZh(ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatbotEnhanced — a lapsed pending action reads Expired (objectstack#34255)', () => {
  it('draws Expired, not the conflict error, when the decision meets a lapsed item', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply(409, {
          success: false,
          error: {
            code: 'RESOURCE_CONFLICT',
            message: 'Pending action pa_1 is no longer pending',
            details: { reason: 'pending_action_lapsed' },
          },
        }),
      ),
    );
    const onDecided = vi.fn();
    renderZh(<Harness onDecided={onDecided} />);

    fireEvent.click(screen.getByText('APPROVE'));

    const strip = await screen.findByTestId('tool-decision');
    await waitFor(() => expect(strip).toHaveAttribute('data-state', 'expired'));
    expect(strip).toHaveTextContent(ZH_EXPIRED);
    expect(strip).toHaveTextContent(ZH_EXPIRED_DETAIL);
    expect(strip).not.toHaveTextContent('409');
    expect(strip).not.toHaveTextContent('no longer pending');
    // The decision is settled: no buttons to press again.
    expect(screen.queryByText('APPROVE')).not.toBeInTheDocument();
    expect(onDecided).toHaveBeenCalledWith('c1', expect.objectContaining({ error: 'pending_action_lapsed' }));
  });

  it('keeps a person’s own rejection a rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { id: 'pa_1', status: 'rejected' })));
    renderZh(<Harness />);

    fireEvent.click(screen.getByText('DENY'));

    const strip = await screen.findByTestId('tool-decision');
    await waitFor(() => expect(strip).toHaveAttribute('data-state', 'success'));
    expect(strip).toHaveTextContent('Rejected');
    expect(strip).not.toHaveTextContent(ZH_EXPIRED);
  });

  it('draws Expired on the record-write card too', () => {
    const decisions: Record<string, ToolDecisionState> = { c1: { state: 'expired', decision: 'approved' } };
    renderZh(
      <ChatbotEnhanced
        messages={transcript(
          {
            status: 'pending_approval',
            pendingActionId: 'pa_2',
            recordWrite: {
              operation: 'create',
              objectName: 'crm_lead',
              objectLabel: '线索',
              fields: [{ name: 'name', label: '姓名', type: 'text', value: '张伟' }],
              dropped: [],
            },
          },
          'create_record',
        )}
        onSendMessage={vi.fn()}
        onToolApprove={vi.fn()}
        toolDecisions={decisions}
      />,
    );
    const line = screen.getByTestId('record-write-decision');
    expect(line).toHaveAttribute('data-state', 'expired');
    expect(line).toHaveTextContent(ZH_EXPIRED);
    expect(line).toHaveTextContent(ZH_EXPIRED_DETAIL);
  });
});

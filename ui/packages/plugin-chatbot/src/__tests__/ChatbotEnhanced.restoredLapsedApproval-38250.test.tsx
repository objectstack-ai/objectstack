/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A chat approval card RESTORED from a saved conversation reads its pending
 * action's row and shows where it settled, without waiting for a press
 * (objectstack#38250, after objectstack#34255).
 *
 * The transcript is the proposal, not its outcome: a restored card says
 * `approval-requested` whatever became of the item since. Before this, a card
 * whose item had lapsed kept Approve and Reject until someone pressed one and
 * met the lapse `409`. Now `useHitlInChat` reads each awaiting card's row once
 * (`GET …/pending-actions/:id`, the endpoint the inbox reads): a lapsed row
 * reads Expired, a row a person rejected reads as that rejection, and anything
 * else, or no answer, leaves the buttons.
 *
 * The hook and the card run together and the assertions are on what a person
 * sees. Rendered in zh: 已过期 comes only from the pack.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';
import { useHitlInChat } from '../useHitlInChat';

const ZH_EXPIRED = '已过期';

/** A saved conversation's approval, restored: still `approval-requested`. */
const restored = () =>
  uiMessagesToChatMessages([
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-action_delete_task',
          toolCallId: 'c1',
          state: 'output-available',
          input: { id: 't1' },
          output: {
            type: 'text',
            value: JSON.stringify({ status: 'pending_approval', pendingActionId: 'pa_9', message: 'Needs approval' }),
          },
        },
      ],
    },
  ]);

function Harness() {
  const messages = React.useMemo(restored, []);
  const hitl = useHitlInChat({ messages, apiBase: '/api/v1/ai' });
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

const row = (fields: Record<string, unknown>) => ({
  id: 'pa_9',
  tool_name: 'action_delete_task',
  action_name: 'delete',
  object_name: 'task',
  tool_input: '{"id":"t1"}',
  proposed_at: new Date().toISOString(),
  ...fields,
});

/** Answer the row read with `body`; any other request fails the test. */
function stubRowRead(status: number, body: unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== 'GET') throw new Error(`unexpected ${init?.method} ${url}`);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderZh() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <Harness />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a restored chat approval card reads where its pending action settled (objectstack#38250)', () => {
  it('shows Expired for a lapsed row, with no press and no buttons', async () => {
    const fetchMock = stubRowRead(200, {
      success: true,
      data: row({ status: 'rejected', rejection_reason: 'lapsed' }),
    });
    renderZh();

    const strip = await screen.findByTestId('tool-decision');
    expect(strip).toHaveAttribute('data-state', 'expired');
    expect(strip).toHaveTextContent(ZH_EXPIRED);
    expect(screen.queryByText('APPROVE')).not.toBeInTheDocument();
    expect(screen.queryByText('DENY')).not.toBeInTheDocument();
    // One read of this card's row, and nothing else sent.
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/v1/ai/pending-actions/pa_9']);
  });

  it('keeps a row a person rejected a rejection, never Expired', async () => {
    // A decider is recorded, even with "lapsed" typed as the reason.
    stubRowRead(200, row({ status: 'rejected', rejection_reason: 'lapsed', decided_by: 'user_2' }));
    renderZh();

    const strip = await screen.findByTestId('tool-decision');
    expect(strip).toHaveAttribute('data-state', 'success');
    expect(strip).toHaveTextContent('Rejected: lapsed');
    expect(strip).not.toHaveTextContent(ZH_EXPIRED);
    expect(screen.queryByText('APPROVE')).not.toBeInTheDocument();
  });

  it('leaves the buttons for a row still pending, and when the read gets no answer', async () => {
    const pending = stubRowRead(200, row({ status: 'pending' }));
    renderZh();
    await waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
    // Let the read settle before looking.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('APPROVE')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-decision')).not.toBeInTheDocument();
    cleanup();

    const missing = stubRowRead(404, { success: false, error: { code: 'NOT_FOUND', message: 'gone' } });
    renderZh();
    await waitFor(() => expect(missing).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('APPROVE')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-decision')).not.toBeInTheDocument();
  });
});

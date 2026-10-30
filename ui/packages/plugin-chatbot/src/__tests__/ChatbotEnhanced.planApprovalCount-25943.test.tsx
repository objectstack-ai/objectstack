/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#25943 — `onPlanApprovalPendingChange(pending, count)` also says
 * how many items the newest proposal asks the user to confirm, so Studio's
 * right slot can show 「AI 副驾 · N 项待确认」 beside the folded copilot.
 *
 *  - a change plan (the copilot's 「修改方案 · N 项」 card) is a proposal: it is
 *    pending while its card offers 存为草稿 / Confirm, and `count` is its rows;
 *  - a proposed plan counts 1, as before it read `true`;
 *  - nothing pending is `(false, 0)`.
 *
 * Every case asserts the reading AND the card it mirrors. The envelopes are the
 * real wire shapes, fed through the real mapper.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessageToChatMessage, uiMessagesToChatMessages } from '../mapMessages';
import { changeRows, draftedEnvelope, proposedEnvelope } from './fixtures/changePosture.fixtures';

/** The proposal turn: `apply_edit` answered with a `changes_proposed` envelope. */
const proposalTurn = (envelope: unknown, id = 'a1', toolCallId = 'call_1') =>
  uiMessageToChatMessage({
    id,
    role: 'assistant',
    parts: [{ type: 'tool-apply_edit', toolCallId, state: 'output-available', input: {}, output: envelope }],
  });

/** The confirm replay of that proposal (`replay_…`), answered with the applied envelope. */
const replayTurn = (envelope: unknown) =>
  uiMessageToChatMessage({
    id: 'a2',
    role: 'assistant',
    parts: [{ type: 'tool-apply_edit', toolCallId: 'replay_t2_0', state: 'output-available', input: {}, output: envelope }],
  });

/** A `propose_blueprint` turn: a proposed plan whose card offers "Build it". */
const planTurn = (id = 'p1') =>
  uiMessagesToChatMessages([
    {
      id,
      role: 'assistant' as const,
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: `plan-${id}`,
          state: 'output-available',
          output: {
            type: 'text',
            value: JSON.stringify({
              status: 'blueprint_proposed',
              summary: 'Helpdesk',
              blueprint: { objects: [{ name: 'ticket', label: 'Ticket', fields: [{ name: 'subject' }] }] },
              counts: { objects: 1, views: 1, dashboards: 0, seedData: 0 },
              questions: [],
              assumptions: [],
            }),
          },
        },
      ],
    },
  ])[0];

/** The last reading the host was told, as `[pending, count]`. */
const lastReading = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1);

describe('ChatbotEnhanced — onPlanApprovalPendingChange carries the count (objectstack#25943)', () => {
  it('a change plan awaiting 存为草稿 reads (true, its rows)', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[proposalTurn(proposedEnvelope('zh', 'draft'))]}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toBeInTheDocument();
    expect(screen.getAllByTestId('proposed-change-row')).toHaveLength(2);
    expect(lastReading(spy)).toEqual([true, 2]);
  });

  it('the click ends the wait at once (the applying flip), before any replay lands', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[proposalTurn(proposedEnvelope('zh', 'draft'))]}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();
    expect(lastReading(spy)).toEqual([false, 0]);
  });

  it('a change the replay saved as a draft is no longer pending', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[proposalTurn(proposedEnvelope('zh', 'draft')), replayTurn(draftedEnvelope('zh'))]}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.queryByTestId('proposed-changes-confirm')).toBeNull();
    expect(lastReading(spy)).toEqual([false, 0]);
  });

  it('a proposed plan counts 1, and a newer change plan supersedes it with its own rows', () => {
    const spy = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[planTurn()]} onSendMessage={vi.fn()} onPlanApprovalPendingChange={spy} />,
    );
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(lastReading(spy)).toEqual([true, 1]);

    const single = { ...proposedEnvelope('en', 'draft'), changes: changeRows('en').slice(0, 1) };
    rerender(
      <ChatbotEnhanced
        messages={[planTurn(), proposalTurn(single, 'a2', 'call_2')]}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.getAllByTestId('proposed-change-row')).toHaveLength(1);
    expect(lastReading(spy)).toEqual([true, 1]);
    expect(spy).toHaveBeenCalledTimes(1);

    rerender(
      <ChatbotEnhanced
        messages={[planTurn(), proposalTurn(proposedEnvelope('en', 'draft'), 'a2', 'call_2')]}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(lastReading(spy)).toEqual([true, 2]);
  });

  it('nothing proposed reads (false, 0)', () => {
    const spy = vi.fn();
    render(<ChatbotEnhanced messages={[]} onPlanApprovalPendingChange={spy} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastReading(spy)).toEqual([false, 0]);
  });
});

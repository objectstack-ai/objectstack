/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10925 — the proposed-plan card's actions wait for the turn to end.
 *
 * The plan card renders as soon as `propose_blueprint` returns, but the
 * proposing turn keeps streaming after that (a `todo_write`, the closing
 * prose) while the server stores each step. In the 2026-09-28 cloud E2E the
 * user clicked 「确认，开始搭建」 inside that window: the next turn was sent while
 * the previous one was still being stored, and the stored history interleaved
 * the two turns (root cause read on PR objectui#10924).
 *
 * Every case feeds the wire shape through the real mapper with the flags
 * `useObjectChat` derives from the AI SDK status: `isLoading` is
 * `submitted | streaming`, and `uiMessagesToChatMessages` marks the trailing
 * assistant message `streaming` from that same value.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

type ChatStatus = 'submitted' | 'streaming' | 'ready';
type WireMessage = Parameters<typeof uiMessagesToChatMessages>[0][number];

const Q_INTERVIEW = 'Track interviews as a separate object or a stage field?';

/** `propose_blueprint` result with no open questions. */
const PLAN = {
  status: 'blueprint_proposed',
  summary: 'A reading-list app',
  blueprint: {
    objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }, { name: 'author' }] }],
  },
  counts: { objects: 1, views: 1, dashboards: 0, seedData: 0 },
  questions: [],
  assumptions: [],
};

/** `propose_blueprint` result whose open question carries one-click answers. */
const PLAN_WITH_CHOICE = {
  ...PLAN,
  questions: [Q_INTERVIEW],
  questionChoices: [{ text: Q_INTERVIEW, options: ['Separate object', 'Stage field'] }],
};

/**
 * The proposing turn as it looks mid-stream: the plan has returned, the turn
 * goes on with a `todo_write` and its closing prose.
 */
function proposingTurn(planResult: unknown, output?: { type: 'text'; value: string }): WireMessage {
  return {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-propose_blueprint',
        toolCallId: 'plan-1',
        state: 'output-available',
        output: output ?? { type: 'text', value: JSON.stringify(planResult) },
      },
      { type: 'tool-todo_write', toolCallId: 'todo-1', state: 'input-available' },
      { type: 'text', text: 'Here is the plan. Build it when you are ready.' },
    ],
  } as WireMessage;
}

/** Props exactly as `useObjectChat` hands them to the host for `status`. */
function chatProps(wire: WireMessage[], status: ChatStatus) {
  const isLoading = status === 'submitted' || status === 'streaming';
  return {
    messages: uiMessagesToChatMessages(wire, { isStreaming: isLoading }),
    isLoading,
  };
}

const LABELS = {
  planApproveMessage: 'APPROVE_PLAIN',
  planApproveDefaultsMessage: 'APPROVE_DEFAULTS',
  planAnswerMessage: (q: string, o: string) => `ANSWER:${q}=${o}`,
};

describe('ChatbotEnhanced — plan card actions wait for the proposing turn (objectui#10925)', () => {
  it('disables Build it and Adjust while the proposing turn streams, and a click sends nothing', () => {
    const onSendMessage = vi.fn();
    const props = chatProps([proposingTurn(PLAN)], 'streaming');
    // Sanity: the card is on the turn that is still streaming.
    expect(props.messages[0].streaming).toBe(true);
    expect(props.messages[0].toolInvocations?.[0].proposedPlan).toBeTruthy();

    render(<ChatbotEnhanced {...props} {...LABELS} onSendMessage={onSendMessage} />);

    const approve = screen.getByTestId('proposed-plan-approve');
    const adjust = screen.getByTestId('proposed-plan-adjust');
    expect(approve).toBeDisabled();
    expect(adjust).toBeDisabled();

    fireEvent.click(approve);
    expect(onSendMessage).not.toHaveBeenCalled();
    // The click did not flip the card to its optimistic Building badge either.
    expect(screen.queryByTestId('proposed-plan-building')).not.toBeInTheDocument();
  });

  it('enables them once that turn finishes, and Build it then sends the approval', () => {
    const onSendMessage = vi.fn();
    const wire = [proposingTurn(PLAN)];
    const { rerender } = render(
      <ChatbotEnhanced {...chatProps(wire, 'streaming')} {...LABELS} onSendMessage={onSendMessage} />,
    );
    expect(screen.getByTestId('proposed-plan-approve')).toBeDisabled();

    rerender(<ChatbotEnhanced {...chatProps(wire, 'ready')} {...LABELS} onSendMessage={onSendMessage} />);

    const approve = screen.getByTestId('proposed-plan-approve');
    expect(approve).toBeEnabled();
    expect(screen.getByTestId('proposed-plan-adjust')).toBeEnabled();

    fireEvent.click(approve);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('APPROVE_PLAIN');
  });

  it('holds the one-click answer chips the same way', () => {
    const onSendMessage = vi.fn();
    const wire = [proposingTurn(PLAN_WITH_CHOICE)];
    const { rerender } = render(
      <ChatbotEnhanced {...chatProps(wire, 'streaming')} {...LABELS} onSendMessage={onSendMessage} />,
    );

    const chip = screen.getByRole('button', { name: 'Stage field' });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onSendMessage).not.toHaveBeenCalled();

    rerender(<ChatbotEnhanced {...chatProps(wire, 'ready')} {...LABELS} onSendMessage={onSendMessage} />);

    const readyChip = screen.getByRole('button', { name: 'Stage field' });
    expect(readyChip).toBeEnabled();
    fireEvent.click(readyChip);
    expect(onSendMessage).toHaveBeenCalledWith(`ANSWER:${Q_INTERVIEW}=Stage field`);
  });

  it('holds the fallback confirm card (a plan that did not parse) the same way', () => {
    const onSendMessage = vi.fn();
    const wire = [
      proposingTurn(undefined, { type: 'text', value: 'I propose a small reading-list app.' }),
    ];
    const streaming = chatProps(wire, 'streaming');
    // Sanity: no structured plan, so the fallback card is the one rendered.
    expect(streaming.messages[0].toolInvocations?.[0].proposedPlan).toBeUndefined();

    const { rerender } = render(
      <ChatbotEnhanced {...streaming} {...LABELS} onSendMessage={onSendMessage} />,
    );
    expect(screen.getByTestId('proposed-plan-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-approve')).toBeDisabled();
    expect(screen.getByTestId('proposed-plan-adjust')).toBeDisabled();
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(onSendMessage).not.toHaveBeenCalled();

    rerender(<ChatbotEnhanced {...chatProps(wire, 'ready')} {...LABELS} onSendMessage={onSendMessage} />);
    expect(screen.getByTestId('proposed-plan-approve')).toBeEnabled();
    expect(screen.getByTestId('proposed-plan-adjust')).toBeEnabled();
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(onSendMessage).toHaveBeenCalledWith('APPROVE_PLAIN');
  });

  it('holds an older plan card while a newer turn is in flight, though its own message is not streaming', () => {
    const onSendMessage = vi.fn();
    const finishedPlanTurn: WireMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: 'plan-1',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(PLAN) },
        },
      ],
    } as WireMessage;
    const userTurn: WireMessage = {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'Add a rating field first.' }],
    } as WireMessage;
    const newerAssistantTurn: WireMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Adding a rating field' }],
    } as WireMessage;

    // `submitted`: the request is out and no chunk has arrived, so NO message
    // carries the streaming flag.
    const submitted = chatProps([finishedPlanTurn, userTurn], 'submitted');
    expect(submitted.messages.some((m) => m.streaming)).toBe(false);
    const { rerender } = render(
      <ChatbotEnhanced {...submitted} {...LABELS} onSendMessage={onSendMessage} />,
    );
    expect(screen.getByTestId('proposed-plan-approve')).toBeDisabled();

    // `streaming`: the newer turn streams below the older card.
    const streaming = chatProps([finishedPlanTurn, userTurn, newerAssistantTurn], 'streaming');
    expect(streaming.messages[0].streaming).toBe(false);
    rerender(<ChatbotEnhanced {...streaming} {...LABELS} onSendMessage={onSendMessage} />);
    expect(screen.getByTestId('proposed-plan-approve')).toBeDisabled();
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(onSendMessage).not.toHaveBeenCalled();

    rerender(
      <ChatbotEnhanced
        {...chatProps([finishedPlanTurn, userTurn, newerAssistantTurn], 'ready')}
        {...LABELS}
        onSendMessage={onSendMessage}
      />,
    );
    expect(screen.getByTestId('proposed-plan-approve')).toBeEnabled();
  });
});

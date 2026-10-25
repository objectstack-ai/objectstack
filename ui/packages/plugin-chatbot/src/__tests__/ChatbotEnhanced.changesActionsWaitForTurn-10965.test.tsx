/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10965 — the confirm-changes card's actions wait for the turn to end.
 *
 * `update_metadata` returns `changes_proposed` mid-turn, and the card renders
 * as soon as that result lands, but the proposing turn keeps streaming while
 * the server stores each remaining step. A Confirm clicked in that window sent
 * the next turn while the previous one was still being stored — the overlap
 * objectui#10925 closed for the proposed-plan card. This card now waits on the
 * same signal (`planActionsLocked`, i.e. `isLoading`).
 *
 * Every case feeds the wire shape through the real mapper with the flags
 * `useObjectChat` derives from the AI SDK status: `isLoading` is
 * `submitted | streaming`, and `uiMessagesToChatMessages` marks the trailing
 * assistant message `streaming` from that same value. The harness mirrors
 * `ChatbotEnhanced.planActionsWaitForTurn-10925.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

type ChatStatus = 'submitted' | 'streaming' | 'ready';
type WireMessage = Parameters<typeof uiMessagesToChatMessages>[0][number];

const CONFIRM = 'CONFIRM_CHANGES';

/** `update_metadata` result: a proposal, not a commit. */
const CHANGES = {
  status: 'changes_proposed',
  summary: 'Add a priority field to task',
  changes: [{ verb: 'add_field', object: 'task', field: 'priority', type: 'select' }],
};

const wrap = (value: unknown) => ({ type: 'text' as const, value: JSON.stringify(value) });

/**
 * The proposing turn as it looks mid-stream: the proposal has returned and the
 * turn goes on with its closing prose.
 */
const proposingTurn: WireMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    {
      type: 'tool-update_metadata',
      toolCallId: 'chg-1',
      state: 'output-available',
      output: wrap(CHANGES),
    },
    { type: 'text', text: 'Here is the change. Confirm it when you are ready.' },
  ],
} as WireMessage;

const userTurn = (text: string): WireMessage =>
  ({ id: 'u2', role: 'user', parts: [{ type: 'text', text }] }) as WireMessage;

/** Props exactly as `useObjectChat` hands them to the host for `status`. */
function chatProps(wire: WireMessage[], status: ChatStatus) {
  const isLoading = status === 'submitted' || status === 'streaming';
  return {
    messages: uiMessagesToChatMessages(wire, { isStreaming: isLoading }),
    isLoading,
  };
}

/** The wire shape of the cloud AI quota refusal (objectui#7253), refused before any token streamed. */
function quotaRefusal(): Error {
  const e = new Error(
    JSON.stringify({
      success: false,
      error: {
        code: 'AI_DESIGN_QUOTA_EXHAUSTED',
        message: 'Quota used up.',
        category: 'rate_limit',
        details: { messageEn: 'Quota used up.', upgrade: true, resetsTonight: true },
      },
    }),
  ) as Error & { notSent?: boolean; status?: number };
  e.notSent = true;
  e.status = 429;
  return e;
}

function expectNoActions() {
  expect(screen.queryByTestId('proposed-changes-confirm')).not.toBeInTheDocument();
  expect(screen.queryByTestId('proposed-changes-adjust')).not.toBeInTheDocument();
}

describe('ChatbotEnhanced — confirm-changes card actions wait for the proposing turn (objectui#10965)', () => {
  it('disables Confirm and Adjust while the proposing turn streams, and a click sends nothing', () => {
    const onSendMessage = vi.fn();
    const props = chatProps([proposingTurn], 'streaming');
    // Sanity: the card is on the turn that is still streaming.
    expect(props.messages[0].streaming).toBe(true);
    expect(props.messages[0].toolInvocations?.[0].proposedChanges).toBeTruthy();

    render(
      <ChatbotEnhanced {...props} changesConfirmMessage={CONFIRM} onSendMessage={onSendMessage} />,
    );

    const confirm = screen.getByTestId('proposed-changes-confirm');
    const adjust = screen.getByTestId('proposed-changes-adjust');
    expect(confirm).toBeDisabled();
    expect(adjust).toBeDisabled();

    fireEvent.click(confirm);
    fireEvent.click(adjust);
    expect(onSendMessage).not.toHaveBeenCalled();
    // The click did not flip the card to its optimistic Applying badge either.
    expect(screen.queryByTestId('proposed-changes-applying')).not.toBeInTheDocument();
  });

  it('enables them once that turn finishes, and Confirm then sends the confirmation', () => {
    const onSendMessage = vi.fn();
    const wire = [proposingTurn];
    const { rerender } = render(
      <ChatbotEnhanced
        {...chatProps(wire, 'streaming')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={onSendMessage}
      />,
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toBeDisabled();

    rerender(
      <ChatbotEnhanced
        {...chatProps(wire, 'ready')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={onSendMessage}
      />,
    );

    const confirm = screen.getByTestId('proposed-changes-confirm');
    expect(confirm).toBeEnabled();
    expect(screen.getByTestId('proposed-changes-adjust')).toBeEnabled();

    fireEvent.click(confirm);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith(CONFIRM);
  });

  it('holds an older card while a newer turn is in flight, though its own message is not streaming', () => {
    const onSendMessage = vi.fn();
    const newerAssistantTurn: WireMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Looking at the task object first' }],
    } as WireMessage;
    const typed = userTurn('Show me the task object first.');

    // `submitted`: the request is out and no chunk has arrived, so NO message
    // carries the streaming flag.
    const submitted = chatProps([proposingTurn, typed], 'submitted');
    expect(submitted.messages.some((m) => m.streaming)).toBe(false);
    const { rerender } = render(
      <ChatbotEnhanced {...submitted} changesConfirmMessage={CONFIRM} onSendMessage={onSendMessage} />,
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toBeDisabled();
    expect(screen.getByTestId('proposed-changes-adjust')).toBeDisabled();

    // `streaming`: the newer turn streams below the older card.
    const streaming = chatProps([proposingTurn, typed, newerAssistantTurn], 'streaming');
    expect(streaming.messages[0].streaming).toBe(false);
    rerender(
      <ChatbotEnhanced {...streaming} changesConfirmMessage={CONFIRM} onSendMessage={onSendMessage} />,
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(onSendMessage).not.toHaveBeenCalled();

    rerender(
      <ChatbotEnhanced
        {...chatProps([proposingTurn, typed, newerAssistantTurn], 'ready')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={onSendMessage}
      />,
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toBeEnabled();
    expect(screen.getByTestId('proposed-changes-adjust')).toBeEnabled();
  });

  it("leaves the card's own states as they were: applying, quota-blocked, confirmed and the read-only hint", async () => {
    // ① applying, optimistic — Confirm at `ready` flips the card, and the
    //    badge stays while the confirming turn is in flight.
    const onSendMessage = vi.fn();
    const confirmed = [proposingTurn, userTurn(CONFIRM)];
    const first = render(
      <ChatbotEnhanced
        {...chatProps([proposingTurn], 'ready')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={onSendMessage}
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();
    first.rerender(
      <ChatbotEnhanced
        {...chatProps(confirmed, 'submitted')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={onSendMessage}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();
    expectNoActions();
    first.unmount();

    // ② applying, from the replay — the runtime's `replay_` re-dispatch of the
    //    same tool is still running on the streaming tail.
    const replayRunning: WireMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [{ type: 'tool-update_metadata', toolCallId: 'replay_u2_0', state: 'input-available' }],
    } as WireMessage;
    const second = render(
      <ChatbotEnhanced
        {...chatProps([...confirmed, replayRunning], 'streaming')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();
    expectNoActions();
    second.unmount();

    // ③ quota-blocked — a Confirm refused with a 429 parks the card, and it
    //    stays parked, with its next step, while a later turn is in flight.
    const third = render(
      <ChatbotEnhanced
        {...chatProps([proposingTurn], 'ready')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    third.rerender(
      <ChatbotEnhanced
        {...chatProps([proposingTurn], 'ready')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={vi.fn()}
        error={quotaRefusal()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('proposed-changes-quota-blocked')).toBeInTheDocument(),
    );
    third.rerender(
      <ChatbotEnhanced
        {...chatProps([proposingTurn, userTurn('What else can you do?')], 'submitted')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-quota-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-quota-reason')).toBeInTheDocument();
    expectNoActions();
    third.unmount();

    // ④ confirmed — the legacy collapse: a later same-tool call that is not a
    //    proposal, here on the turn that is still streaming.
    const commitTurn: WireMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [
        {
          type: 'tool-update_metadata',
          toolCallId: 'chg-2',
          state: 'output-available',
          output: wrap({ success: true }),
        },
      ],
    } as WireMessage;
    const fourth = render(
      <ChatbotEnhanced
        {...chatProps([...confirmed, commitTurn], 'streaming')}
        changesConfirmMessage={CONFIRM}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-confirmed')).toBeInTheDocument();
    expectNoActions();
    fourth.unmount();

    // ⑤ the read-only hint — no `onSendMessage`, no buttons, in flight or not.
    render(<ChatbotEnhanced {...chatProps([proposingTurn], 'streaming')} />);
    expect(screen.getByTestId('proposed-changes')).toHaveTextContent(
      'Reply to confirm or adjust this change.',
    );
    expectNoActions();
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Question-card topic, Q2b — the question card wired into the conversation:
 * it takes the composer's place without unmounting it, an answer is the next
 * message, a skip is remembered per conversation on this device, the thread
 * draws the question from its envelope, and a pending question is not
 * regenerated. Every interaction goes through the rendered component.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { QUESTION_SKIP_STORAGE_PREFIX } from '../chat/questionSkip';
import type { ChatbotEnhancedMessage } from '../chat/types';

const REPLY = 'Which revenue did you mean?\n- Booked revenue\n- Invoiced revenue';

const ASKED: ChatbotEnhancedMessage[] = [
  { id: 'u1', role: 'user', content: 'Show me revenue' },
  {
    id: 'a1',
    role: 'assistant',
    content: REPLY,
    toolInvocations: [{
      toolCallId: 'call_q',
      toolName: 'ask_which',
      state: 'output-available',
      result: {
        type: 'text',
        value: JSON.stringify({
          success: true,
          status: 'asked_which',
          question: 'Which revenue did you mean?',
          readings: ['Booked revenue', 'Invoiced revenue'],
          reply: REPLY,
        }),
      },
    }],
  },
];

const ANSWERED: ChatbotEnhancedMessage[] = [
  ...ASKED,
  { id: 'u2', role: 'user', content: 'Booked revenue' },
  { id: 'a2', role: 'assistant', content: 'Booked revenue this quarter is 1.2M.' },
];

afterEach(() => {
  localStorage.clear();
});

describe('Q2b — the card takes the composer place', () => {
  it('shows the card once the turn ended on a question; the composer stays mounted, hidden and inert', () => {
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} placeholder="Ask…" />);
    const holder = screen.getByTestId('composer-gate-holder');
    expect(holder).toBeVisible();
    expect(within(holder).getByTestId('question-card')).toHaveTextContent('Which revenue did you mean?');
    const composer = screen.getByTestId('composer-gate-composer');
    expect(composer).not.toBeVisible();
    expect(composer).toHaveAttribute('inert');
    // Mounted, not removed: the textarea is still in the document.
    expect(screen.getByPlaceholderText('Ask…')).toBeInTheDocument();
  });

  it('control: no card while the turn is still running', () => {
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} isLoading placeholder="Ask…" />);
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-gate-composer')).toBeVisible();
  });

  it('keeps the draft typed before the card opened, and gives it back after a skip', () => {
    const { rerender } = render(
      <ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'half a thought' } });
    rerender(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} placeholder="Ask…" />);
    expect(screen.getByTestId('question-card')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-gate-composer')).toBeVisible();
    expect(screen.getByPlaceholderText('Ask…')).toBe(textarea);
    expect(textarea.value).toBe('half a thought');
  });

  it('answers with one click: the label is sent as the next message', () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={onSendMessage} placeholder="Ask…" />);
    fireEvent.click(screen.getByRole('radio', { name: /Invoiced revenue/ }));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('Invoiced revenue');
  });

  it('a failed send brings the card back with the choice still made', () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={ASKED} onSendMessage={onSendMessage} placeholder="Ask…" />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Invoiced revenue/ }));
    // The optimistic bubble: the question has moved on.
    rerender(
      <ChatbotEnhanced
        messages={[...ASKED, { id: 'u2', role: 'user', content: 'Invoiced revenue' }]}
        onSendMessage={onSendMessage}
        placeholder="Ask…"
      />,
    );
    expect(screen.getByTestId('composer-gate-composer')).toBeVisible();
    // The send is refused and the bubble rolls back: the question is pending again.
    rerender(
      <ChatbotEnhanced
        messages={ASKED}
        onSendMessage={onSendMessage}
        error={Object.assign(new Error('Too many requests'), { notSent: true })}
        placeholder="Ask…"
      />,
    );
    expect(screen.getByTestId('question-card')).toBeVisible();
    expect(screen.getByRole('radio', { name: /Invoiced revenue/ })).toHaveAttribute('aria-checked', 'true');
    // The answer is not typed text, so nothing is put back in the composer.
    expect((screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement).value).toBe('');
  });

  it('a queued message holds the card back', () => {
    const { rerender } = render(
      <ChatbotEnhanced messages={ASKED.slice(0, 1)} onSendMessage={vi.fn()} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'actually, show costs' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    rerender(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} isLoading placeholder="Ask…" />);
    expect(screen.getByTestId('composer-queued-item')).toBeInTheDocument();
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
  });

  it('no card on a read-only transcript, which draws the question as past', () => {
    render(<ChatbotEnhanced messages={ASKED} readOnly />);
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-message')).toHaveAttribute('data-state', 'past');
  });
});

describe('Q2b — a skip is remembered per conversation on this device', () => {
  it('writes the question id under the conversation key, and the card stays away on the next mount', () => {
    const { unmount } = render(
      <ChatbotEnhanced messages={ASKED} conversationId="conv-1" onSendMessage={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(JSON.parse(localStorage.getItem(`${QUESTION_SKIP_STORAGE_PREFIX}:conv-1`) ?? 'null')).toEqual(['call_q']);
    expect(QUESTION_SKIP_STORAGE_PREFIX).toBe('objectstack:ai-chat-question-skip');
    unmount();

    render(<ChatbotEnhanced messages={ASKED} conversationId="conv-1" onSendMessage={vi.fn()} />);
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-message')).toHaveAttribute('data-state', 'past');
  });

  it('control: another conversation is not skipped', () => {
    localStorage.setItem(`${QUESTION_SKIP_STORAGE_PREFIX}:conv-1`, JSON.stringify(['call_q']));
    render(<ChatbotEnhanced messages={ASKED} conversationId="conv-2" onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('question-card')).toBeVisible();
  });

  it('a stored mark that is not a list is ignored', () => {
    localStorage.setItem(`${QUESTION_SKIP_STORAGE_PREFIX}:conv-1`, '{not json');
    render(<ChatbotEnhanced messages={ASKED} conversationId="conv-1" onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('question-card')).toBeVisible();
  });
});

describe('Q2b — the thread draws the question from its envelope', () => {
  it('pending: the question alone, no options, no bullets parsed out of the reply', () => {
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} />);
    const message = screen.getByTestId('question-message');
    expect(message).toHaveAttribute('data-state', 'pending');
    expect(message).toHaveTextContent('AI asks: Which revenue did you mean?');
    expect(within(message).queryByText('Booked revenue')).not.toBeInTheDocument();
    expect(within(message).queryByText(/- Booked revenue/)).not.toBeInTheDocument();
  });

  it('past: a collapsed question that expands to its options', () => {
    render(<ChatbotEnhanced messages={ANSWERED} onSendMessage={vi.fn()} />);
    const message = screen.getByTestId('question-message');
    expect(message).toHaveAttribute('data-state', 'past');
    const details = message.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(message).getByText('Booked revenue')).toBeInTheDocument();
    expect(within(message).getByText('Invoiced revenue')).toBeInTheDocument();
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
  });

  it('control: a turn whose text is not the reply renders as text', () => {
    const other: ChatbotEnhancedMessage[] = [ASKED[0], { ...ASKED[1], content: 'Here is your revenue.' }];
    render(<ChatbotEnhanced messages={other} onSendMessage={vi.fn()} />);
    expect(screen.queryByTestId('question-message')).not.toBeInTheDocument();
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
    expect(screen.getByText('Here is your revenue.')).toBeInTheDocument();
  });
});

describe('Q2b — a pending question is answered, not regenerated', () => {
  it('hides Regenerate on the pending question and keeps Copy', () => {
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('Copy copies the full reply, bullets included', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ChatbotEnhanced messages={ASKED} onSendMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(REPLY));
  });

  it('control: once answered, the question turn regenerates as before', () => {
    render(<ChatbotEnhanced messages={ANSWERED} onSendMessage={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Regenerate' }).length).toBe(2);
  });
});

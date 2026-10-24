/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Composer send-failure UX: when a message is rejected before it reaches the
 * model (rate-limit / network — `notSent`), the typed text must be RESTORED to
 * the box (not silently dropped) and a clear inline notice shown — NOT the
 * "Response failed / Retry" banner (which would regenerate the rolled-back turn).
 * A streamed-response error still shows the banner. A clean submit clears the box.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const LABELS = {
  sendFailedRateLimited: 'RATE_LIMIT_MSG',
  sendFailedGeneric: 'GENERIC_MSG',
};

/** Tagged error shaped like one from sendAwareFetch. */
function notSentError(status?: number): Error {
  const e = new Error(status === 429 ? '{"error":"rate_limited"}' : 'boom') as Error & {
    notSent?: boolean;
    status?: number;
  };
  e.notSent = true;
  if (status) e.status = status;
  return e;
}

async function submit(text: string, onSendMessage: () => void) {
  const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.submit(textarea.closest('form')!);
  // prompt-input calls onSubmit in a microtask (after blob conversion).
  await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
  return textarea;
}

describe('ChatbotEnhanced send-failure UX', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('restores the input and shows a rate-limit notice on a 429 (no Retry banner)', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />,
    );

    const textarea = await submit('build me a CRM', onSendMessage);
    expect(onSendMessage.mock.calls[0][0]).toBe('build me a CRM');
    // The composer optimistically cleared the box on submit…
    expect(textarea.value).toBe('');

    // …then the send is rejected with a 429.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        error={notSentError(429)}
      />,
    );

    // ① input restored, ② clear error shown, and NOT the generic "Response failed" banner.
    await waitFor(() => expect(textarea.value).toBe('build me a CRM'));
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('RATE_LIMIT_MSG');
    expect(screen.queryByText(/Response failed/i)).not.toBeInTheDocument();
  });

  it('uses the generic notice for a non-429 not-sent failure (network / 5xx)', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />,
    );
    const textarea = await submit('hello there', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        error={notSentError(503)}
      />,
    );

    await waitFor(() => expect(textarea.value).toBe('hello there'));
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('GENERIC_MSG');
  });

  it('shows the Response-failed banner (not the send notice) for a streamed-response error', async () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        onReload={vi.fn()}
        error={new Error('stream dropped mid-turn')}
      />,
    );

    expect(screen.getByText(/Response failed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });

  it('a clean submit (no error) leaves the box cleared — text is only kept on failure', async () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />);
    const textarea = await submit('all good', onSendMessage);
    // No error prop → nothing restored; the optimistic clear stands.
    expect(textarea.value).toBe('');
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });
});

/**
 * objectui#2627 — the ROLLBACK half of the plan card's optimistic approve.
 * Clicking "Build it" flips the card to a "Building…" badge before the server
 * has said anything (#2632, pinned in ChatbotEnhanced.test.tsx). When that
 * approval never left the client — a 429 or an offline send, tagged `notSent` —
 * the optimistic badge is a lie AND a dead end: the badge replaces the buttons,
 * so with no rollback the user cannot re-approve at all and the build silently
 * never starts. The happy flip was pinned on its own; this is the other side.
 */
const planMessage: ChatbotEnhancedMessage[] = [
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 't1',
        toolName: 'propose_blueprint',
        state: 'output-available',
        proposedPlan: {
          summary: 'A tiny CRM',
          objects: [{ name: 'contact', label: 'Contact', fieldCount: 4 }],
          counts: { objects: 1, views: 1, dashboards: 0, seedData: 0 },
          questions: [],
          assumptions: [],
        },
      },
    ],
  } as unknown as ChatbotEnhancedMessage,
];

describe('ChatbotEnhanced plan approval — optimistic flip rollback (#2627)', () => {
  it('rolls the "Building…" badge back to the buttons when the approval never left the client', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );

    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(screen.getByTestId('proposed-plan-building')).toHaveTextContent('BUILDING_NOW');
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();

    // The approval was rejected before reaching the model (rate limit).
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        error={notSentError(429)}
      />,
    );

    // The card must be actionable again — nothing is building.
    await waitFor(() =>
      expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('proposed-plan-building')).not.toBeInTheDocument();
    // …and the failure is surfaced, not swallowed.
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('RATE_LIMIT_MSG');
  });

  it('a STREAMED-response error leaves the badge alone — that approval did reach the server', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));

    // Not `notSent`: the turn started and the stream dropped. Re-offering
    // "Build it" here invites a SECOND build of the same plan.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        onReload={vi.fn()}
        error={new Error('stream dropped mid-turn')}
      />,
    );

    expect(screen.getByTestId('proposed-plan-building')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });

  it('a LATER send supersedes the approve — its failure must not re-open the built card', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    // The approval went through; the user then types something that does not.
    await submit('also add invoices', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        error={notSentError(429)}
      />,
    );

    // The composer text is restored, but the plan card stays "Building…" —
    // rolling it back would offer a second build of a plan already building.
    await waitFor(() => expect(screen.getByTestId('chat-send-error')).toBeInTheDocument());
    expect(screen.getByTestId('proposed-plan-building')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });
});

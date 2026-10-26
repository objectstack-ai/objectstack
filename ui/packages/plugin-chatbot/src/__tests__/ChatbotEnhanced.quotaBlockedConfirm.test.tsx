/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7253 — the paywall moment on the 确认修改 (confirm-changes) card.
 *
 * Measured on the local rig: a free user's SECOND build iteration clicked
 * "Confirm changes" and the cloud token guardrail refused it with a 429
 * (`AI_DESIGN_QUOTA_EXHAUSTED`). Two things then went wrong on top of the
 * refusal itself:
 *
 *   1. the card rolled straight back to "Confirm / Adjust" — indistinguishable
 *      from a card still waiting for the user, so nothing on it said the click
 *      had failed, and clicking again just bought the same 429;
 *   2. the composer was refilled with the user's PREVIOUS message — one that had
 *      already been delivered and answered — because the card's canned approval
 *      text left the "restore my typing" slot pointing at stale input.
 *
 * The rollback itself is correct for a TRANSIENT failure (offline, per-minute
 * rate limit), so it stays; the split is on the quota refusal only, and both
 * halves are pinned here.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const QUOTA_ZH = '今天的 AI 设计额度已用完，明天会重置；升级后可继续设计。';
const QUOTA_EN = "You've used today's free AI design quota. It resets tomorrow — upgrade to keep designing.";

/**
 * The wire shape the cloud guardrail actually sends (ADR-0112 declared envelope
 * carrying the closed ledger code), tagged the way `sendAwareFetch` tags a POST
 * that was refused BEFORE any tokens streamed.
 */
function quotaRefusal(): Error {
  const e = new Error(
    JSON.stringify({
      success: false,
      error: {
        code: 'AI_DESIGN_QUOTA_EXHAUSTED',
        message: QUOTA_ZH,
        category: 'rate_limit',
        details: { messageEn: QUOTA_EN, upgrade: true, resetsTonight: true },
      },
    }),
  ) as Error & { notSent?: boolean; status?: number };
  e.notSent = true;
  e.status = 429;
  return e;
}

/** A transient not-sent failure — same `notSent` tag, no quota code. */
function offlineFailure(): Error {
  const e = new Error('Failed to fetch') as Error & { notSent?: boolean };
  e.notSent = true;
  return e;
}

function changesMessage(): ChatbotEnhancedMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'update_metadata',
          state: 'output-available',
          proposedChanges: {
            summary: 'Two edits to the task object',
            changes: [{ verb: 'add_field', object: 'task', field: 'priority', type: 'select' }],
          },
        },
      ],
    } as unknown as ChatbotEnhancedMessage,
  ];
}

/** Type + submit a message, the way the user's earlier turn reached the agent. */
async function typeAndSend(text: string, onSendMessage: ReturnType<typeof vi.fn>) {
  const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.submit(textarea.closest('form')!);
  await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
  return textarea;
}

describe('confirm card — AI quota refusal (objectui#7253)', () => {
  it('parks the card in an explicit blocked state with the next step, instead of re-offering Confirm', async () => {
    const onSendMessage = vi.fn();
    const onUpgrade = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        onUpgrade={onUpgrade}
      />,
    );

    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        onUpgrade={onUpgrade}
        error={quotaRefusal()}
      />,
    );

    // ① The card says the click failed…
    await waitFor(() =>
      expect(screen.getByTestId('proposed-changes-quota-blocked')).toBeInTheDocument(),
    );
    // ② …and does NOT hand back the button that just bought a 429, nor keep
    //    claiming the change is being applied.
    expect(screen.queryByTestId('proposed-changes-confirm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-applying')).not.toBeInTheDocument();
    // ③ The next step is on the card: the server's own sentence (which names
    //    both exits — tomorrow's reset and the upgrade) plus the action.
    expect(screen.getByTestId('proposed-changes-quota-reason')).toHaveTextContent(
      new RegExp(`${QUOTA_ZH}|resets tomorrow`),
    );
    fireEvent.click(screen.getByTestId('proposed-changes-quota-upgrade'));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('does not refill the composer with the message the user already sent', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
      />,
    );

    // The user's real turn — delivered, answered, and the reason a proposal
    // card exists at all.
    const textarea = await typeAndSend('also track the due date', onSendMessage);
    expect(textarea.value).toBe('');

    // Now the card click, refused by the paywall.
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        error={quotaRefusal()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('proposed-changes-quota-blocked')).toBeInTheDocument(),
    );
    // The bug: 'also track the due date' reappeared here, reading as "resend
    // this" for a message that was never lost.
    expect(textarea.value).toBe('');
  });

  it('renders the blocked badge without a next step when the host wired no upgrade action', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        error={quotaRefusal()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('proposed-changes-quota-blocked')).toBeInTheDocument(),
    );
    // A runtime with no upstream cloud passes no `onUpgrade` — the reason still
    // shows; the button that would go nowhere does not.
    expect(screen.getByTestId('proposed-changes-quota-reason')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-quota-upgrade')).not.toBeInTheDocument();
  });
});

describe('confirm card — transient not-sent failure keeps the retry path', () => {
  it('rolls back to Confirm / Adjust, blocks nothing, and refills nothing', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
      />,
    );

    const textarea = await typeAndSend('add a status field', onSendMessage);
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        error={offlineFailure()}
      />,
    );

    // Retrying IS the right next step for a dropped connection, so the buttons
    // come back and nothing is blocked…
    await waitFor(() => expect(screen.getByTestId('proposed-changes-confirm')).toBeInTheDocument());
    expect(screen.queryByTestId('proposed-changes-quota-blocked')).not.toBeInTheDocument();
    // …but the composer still isn't refilled: what failed was the card's canned
    // approval, not the earlier message, which the agent already answered.
    expect(textarea.value).toBe('');
  });

  it('still restores text the user typed when THAT send is the one refused', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} />,
    );
    const textarea = await typeAndSend('add a status field', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        error={offlineFailure()}
      />,
    );

    // The unchanged half of the send-failure UX: this text never reached the
    // model and the composer is the only place it exists.
    await waitFor(() => expect(textarea.value).toBe('add a status field'));
  });
});

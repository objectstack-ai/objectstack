/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7254 — the tool card's HEADER badge and its BODY badge must be one
 * fact.
 *
 * The header derived "Awaiting Approval" from `isProposalResult(tool.result)`
 * alone — a property of the tool's own output, which never changes once the
 * tool has returned. Meanwhile the body collapsed to 已生效 / 已搭建 / 未生效
 * from four other memos the header did not read. So a card the user had
 * already confirmed, and whose body said so, kept a header telling them it was
 * still waiting for them. Same class as the divergence recorded on cloud#787,
 * mirrored.
 *
 * These pins drive the real message stream (proposal turn + replay turn) and
 * assert BOTH badges together — asserting either alone is what let them drift.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ChatbotEnhanced,
  resolveProposalCardState,
  type ChatbotEnhancedMessage,
} from '../ChatbotEnhanced';

/** A granular edit that RETURNED a confirm-gate preview. */
function proposalMessage(): ChatbotEnhancedMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 't1',
        toolName: 'apply_edit',
        state: 'output-available',
        // The header reads the RESULT, so the pin has to carry the real
        // envelope — `proposedChanges` alone never reached that branch.
        result: { status: 'changes_proposed', changes: [{ verb: 'add_field' }] },
        proposedChanges: {
          changes: [{ verb: 'add_field', object: 'task', field: 'priority' }],
        },
      },
    ],
  };
}

function replayMessage(
  outcome: NonNullable<NonNullable<ChatbotEnhancedMessage['toolInvocations']>[number]['replayOutcome']>,
): ChatbotEnhancedMessage {
  return {
    id: 'a2',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 'replay_turn_0',
        toolName: 'apply_edit',
        state: 'output-available',
        result: '{}',
        replayOutcome: outcome,
      },
    ],
  };
}

/** The header badge text of the (single) tool card on screen. */
function headerBadgeText(): string {
  const trigger = document.querySelector('[data-state]')!;
  return trigger.textContent ?? '';
}

describe('resolveProposalCardState — one producer for both badges', () => {
  it('nothing has happened yet → pending', () => {
    expect(resolveProposalCardState({})).toBe('pending');
  });

  it('a replay verdict outranks the positional heuristics', () => {
    expect(resolveProposalCardState({ replayOutcome: { kind: 'published' } })).toBe('settled');
    expect(resolveProposalCardState({ replayOutcome: { kind: 'drafted' } })).toBe('settled');
    expect(resolveProposalCardState({ replayOutcome: { kind: 'applying' } })).toBe('in-progress');
    // A failure with `confirmed` also true stays failed — the user DID confirm,
    // and the card must not report the confirmation as the outcome.
    expect(
      resolveProposalCardState({ replayOutcome: { kind: 'failed' }, confirmed: true }),
    ).toBe('failed');
  });

  it('an observed later commit settles the card; a bare approval only starts it', () => {
    expect(resolveProposalCardState({ built: true })).toBe('settled');
    expect(resolveProposalCardState({ confirmed: true })).toBe('settled');
    expect(resolveProposalCardState({ approved: true })).toBe('in-progress');
    // "Built" is an observation of the stream, "approved" is a click — the
    // observation wins when both are set.
    expect(resolveProposalCardState({ approved: true, built: true })).toBe('settled');
  });
});

describe('ChatbotEnhanced — the header badge follows the card body (objectui#7254)', () => {
  it('an unanswered proposal still reads as awaiting on both surfaces', () => {
    render(<ChatbotEnhanced messages={[proposalMessage()]} onSendMessage={vi.fn()} />);
    expect(headerBadgeText()).toContain('Awaiting approval');
    // The body is still offering the confirm button — nothing has been applied.
    expect(screen.getByTestId('proposed-changes-confirm')).toBeInTheDocument();
  });

  it('a published replay flips the header to Completed, matching the Applied body badge', () => {
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'published' })]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applied')).toBeInTheDocument();
    const header = headerBadgeText();
    expect(header).toContain('Completed');
    expect(header).not.toContain('Awaiting');
  });

  it('a drafted replay is settled too — the change left the proposal state', () => {
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'drafted', packageId: 'app.k9qk' })]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-drafted')).toBeInTheDocument();
    expect(headerBadgeText()).not.toContain('Awaiting');
  });

  it('a failed replay reads as an error, not as "still waiting for you"', () => {
    render(
      <ChatbotEnhanced
        messages={[
          proposalMessage(),
          replayMessage({ kind: 'failed', error: 'publish rolled back' }),
        ]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-failed')).toBeInTheDocument();
    const header = headerBadgeText();
    expect(header).toContain('Error');
    expect(header).not.toContain('Awaiting');
  });
});

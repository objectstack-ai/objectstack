/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11666 — `onPlanApprovalPendingChange` reports whether the thread's
 * NEWEST proposed plan still waits for the user, so a host can mirror it
 * outside the chat (the console's launchers show a marker while the chat is
 * closed).
 *
 * The reading must be the plan card's own: `pending` from
 * `resolveProposalCardState`, i.e. exactly when the card offers "Build it".
 * Every case below asserts the callback AND the card it mirrors, so the two can
 * never be pinned apart. The envelopes are the real wire shapes, fed through
 * the real mapper (`uiMessagesToChatMessages`), as in the objectui#8343 suite.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

function proposal(summary: string) {
  return {
    status: 'blueprint_proposed',
    summary,
    blueprint: {
      objects: [{ name: 'ticket', label: 'Ticket', fields: [{ name: 'subject' }] }],
    },
    counts: { objects: 1, views: 1, dashboards: 0, seedData: 0 },
    questions: [],
    assumptions: [],
  };
}

const BUILD_DRAFTED = {
  status: 'drafted',
  summary: 'Created 1 object',
  drafted: [{ type: 'object', name: 'ticket' }],
};

const AWAITING_CONFIRMATION = {
  status: 'awaiting_confirmation',
  message: 'A confirm card for this blueprint was just shown to the user.',
};

type Part = { type: string; toolCallId?: string; state?: string; output?: unknown; text?: string };

function toolPart(tool: string, toolCallId: string, result: unknown): Part {
  return {
    type: `tool-${tool}`,
    toolCallId,
    state: 'output-available',
    output: { type: 'text', value: JSON.stringify(result) },
  };
}

function thread(...turns: Part[][]) {
  return uiMessagesToChatMessages(
    turns.map((parts, i) => ({ id: `a${i + 1}`, role: 'assistant' as const, parts })),
  );
}

/** The last value the host was told. */
function lastReading(spy: ReturnType<typeof vi.fn>): unknown {
  return spy.mock.calls.at(-1)?.[0];
}

describe('ChatbotEnhanced — onPlanApprovalPendingChange (objectui#11666)', () => {
  it('reports true while the proposed plan offers "Build it"', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={thread([toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'))])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(lastReading(spy)).toBe(true);
  });

  it('reports false for a thread with no proposed plan', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={thread([{ type: 'text', text: 'Hello' }])}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastReading(spy)).toBe(false);
  });

  it('turns false the moment the user approves (the optimistic "Building…" flip)', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={thread([toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'))])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(lastReading(spy)).toBe(true);

    fireEvent.click(screen.getByTestId('proposed-plan-approve'));

    expect(screen.getByTestId('proposed-plan-building')).toBeInTheDocument();
    expect(lastReading(spy)).toBe(false);
  });

  it('turns false once the build ran, and stays true while the build only asked to confirm (#8343)', () => {
    const plan = toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'));
    const spy = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        messages={thread([plan], [toolPart('apply_blueprint', 'apply-1', AWAITING_CONFIRMATION)])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    // A confirm-gate preview built nothing — the plan is still the user's to approve.
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(lastReading(spy)).toBe(true);

    rerender(
      <ChatbotEnhanced
        messages={thread([plan], [toolPart('apply_blueprint', 'apply-1', BUILD_DRAFTED)])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
    expect(lastReading(spy)).toBe(false);
  });

  it('follows the NEWEST plan: a newer proposal supersedes the one before it', () => {
    const first = toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'));
    const build = toolPart('apply_blueprint', 'apply-1', BUILD_DRAFTED);
    const second = toolPart('propose_blueprint', 'plan-2', proposal('Helpdesk with SLAs'));
    const spy = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        messages={thread([first], [build])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(lastReading(spy)).toBe(false);

    // A newer proposal after a built one: the newer card is the one awaiting.
    rerender(
      <ChatbotEnhanced
        messages={thread([first], [build], [second])}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(screen.getAllByTestId('proposed-plan-approve')).toHaveLength(1);
    expect(lastReading(spy)).toBe(true);
  });

  it('an older plan a newer one superseded does not keep the reading alive', () => {
    const spy = vi.fn();
    render(
      <ChatbotEnhanced
        messages={thread(
          [toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'))],
          [toolPart('propose_blueprint', 'plan-2', proposal('Helpdesk with SLAs'))],
        )}
        onSendMessage={vi.fn()}
        onPlanApprovalPendingChange={spy}
      />,
    );
    expect(lastReading(spy)).toBe(true);

    // Approving the newer plan ends the wait, even though the superseded card
    // above it still renders its own (stale) "Build it".
    fireEvent.click(screen.getAllByTestId('proposed-plan-approve')[1]);
    expect(screen.getAllByTestId('proposed-plan-approve')).toHaveLength(1);
    expect(lastReading(spy)).toBe(false);
  });

  it('announces a change once — a fresh callback identity does not re-announce an unchanged reading', () => {
    const messages = thread([toolPart('propose_blueprint', 'plan-1', proposal('Helpdesk'))]);
    const first = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={messages} onSendMessage={vi.fn()} onPlanApprovalPendingChange={first} />,
    );
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    rerender(
      <ChatbotEnhanced messages={messages} onSendMessage={vi.fn()} onPlanApprovalPendingChange={second} />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5695 — the 确认修改 card's terminal states after approval.
 *
 * Clicking 确认修改 makes the runtime re-dispatch the proposal under a
 * `replay_<id>` tool call. Before this card knew about replays, everything
 * after the click was a black box: the card looked untouched, a REFUSED
 * publish (`publishFailed:true, publishOutcome:'rolled_back'`) existed only in
 * a tool-result JSON the user never sees, and the agent could narrate success
 * over it (the 2026-08-22 staging E2E on cloud#1584). These pins drive each
 * replay envelope shape through the real message stream and assert the card
 * renders the verdict — the failure state above all, because a UI-rendered
 * refusal is the layer a model cannot talk over.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

function proposalMessage(): ChatbotEnhancedMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 't1',
        toolName: 'update_metadata',
        state: 'output-available',
        proposedChanges: {
          changes: [{ verb: 'add_field', object: 'task', field: 'priority' }],
        },
      },
    ],
  };
}

function replayMessage(
  outcome: NonNullable<
    NonNullable<ChatbotEnhancedMessage['toolInvocations']>[number]['replayOutcome']
  > | undefined,
  extra: Partial<NonNullable<ChatbotEnhancedMessage['toolInvocations']>[number]> = {},
): ChatbotEnhancedMessage {
  return {
    id: 'a2',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 'replay_turn_0',
        toolName: 'update_metadata',
        state: 'output-available',
        result: '{}',
        ...(outcome ? { replayOutcome: outcome } : {}),
        ...extra,
      },
    ],
  };
}

describe('ChatbotEnhanced — confirm card replay terminal states (objectui#5695)', () => {
  it('published replay → the card shows the Applied badge, no live buttons', () => {
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'published' })]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applied')).toHaveTextContent('Applied');
    expect(screen.queryByTestId('proposed-changes-confirm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-confirmed')).not.toBeInTheDocument();
  });

  it('drafted replay → Saved-as-draft badge, with an inline publish affordance when the host can publish', () => {
    const onPublishDrafts = vi.fn(async () => true);
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'drafted', packageId: 'app.k9qk' })]}
        onSendMessage={vi.fn()}
        onPublishDrafts={onPublishDrafts}
      />,
    );
    expect(screen.getByTestId('proposed-changes-drafted')).toHaveTextContent('Saved as draft');
    fireEvent.click(screen.getByTestId('proposed-changes-publish'));
    expect(onPublishDrafts).toHaveBeenCalledWith('app.k9qk');
  });

  it('drafted replay without a publish host (read-only share page) → badge only, no button', () => {
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'drafted', packageId: 'app.k9qk' })]}
      />,
    );
    expect(screen.getByTestId('proposed-changes-drafted')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-publish')).not.toBeInTheDocument();
  });

  it('failed replay → Not-applied badge carrying the publishError headline; the point of the card', () => {
    render(
      <ChatbotEnhanced
        messages={[
          proposalMessage(),
          replayMessage({
            kind: 'failed',
            outcome: 'rolled_back',
            error: 'publish gate: dangling view reference k9qk_task.board',
          }),
        ]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-failed')).toHaveTextContent('Not applied');
    expect(screen.getByTestId('proposed-changes-failed-reason')).toHaveTextContent(
      'dangling view reference',
    );
    // The legacy positional 已确认 badge must NOT win over the failure verdict —
    // that would be the old "narrated success" bug in UI form.
    expect(screen.queryByTestId('proposed-changes-confirmed')).not.toBeInTheDocument();
  });

  it('replay still in flight (no result yet) → Applying… spinner state', () => {
    render(
      <ChatbotEnhanced
        messages={[
          proposalMessage(),
          replayMessage(undefined, { state: 'input-available', result: undefined }),
        ]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applying')).toHaveTextContent('Applying…');
  });

  it('clicking 确认修改 flips the card to Applying… optimistically', () => {
    render(<ChatbotEnhanced messages={[proposalMessage()]} onSendMessage={vi.fn()} />);
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(screen.getByTestId('proposed-changes-applying')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-confirm')).not.toBeInTheDocument();
  });

  it('a second proposal after a replayed one keeps its own live buttons (positional, per-card)', () => {
    const second: ChatbotEnhancedMessage = {
      id: 'a3',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't2',
          toolName: 'update_metadata',
          state: 'output-available',
          proposedChanges: { changes: [{ verb: 'delete_field', object: 'task', field: 'old' }] },
        },
      ],
    };
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), replayMessage({ kind: 'published' }), second]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applied')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-confirm')).toBeInTheDocument();
  });
});

describe('self-repair supersede (objectui#5695 follow-up)', () => {
  const dispatchFailedReplay = (): ChatbotEnhancedMessage =>
    replayMessage({
      kind: 'failed',
      dispatchError: true,
      error: 'apply_edit op #1 (add_field): object "task" not found.',
    });

  it('a dispatch-errored replay with NO later verdict renders the failure state', () => {
    render(
      <ChatbotEnhanced messages={[proposalMessage(), dispatchFailedReplay()]} onSendMessage={vi.fn()} />,
    );
    expect(screen.getByTestId('proposed-changes-failed')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-failed-reason')).toHaveTextContent('not found');
  });

  it("the model's later successful authoring result supersedes the dispatch error — never 未生效 over a landed change", () => {
    const selfRepair: ChatbotEnhancedMessage = {
      id: 'a3',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 'toolu_selfrepair',
          toolName: 'add_field',
          state: 'output-available',
          result: JSON.stringify({ status: 'published' }),
        },
      ],
    };
    render(
      <ChatbotEnhanced
        messages={[proposalMessage(), dispatchFailedReplay(), selfRepair]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-applied')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-failed')).not.toBeInTheDocument();
  });

  it('a REAL publish failure (publishFailed envelope) is NOT superseded by later results', () => {
    const later: ChatbotEnhancedMessage = {
      id: 'a3',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 'toolu_other',
          toolName: 'list_objects',
          state: 'output-available',
          result: JSON.stringify({ status: 'published' }),
        },
      ],
    };
    render(
      <ChatbotEnhanced
        messages={[
          proposalMessage(),
          replayMessage({ kind: 'failed', outcome: 'rolled_back', error: 'publish gate refused' }),
          later,
        ]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-changes-failed')).toBeInTheDocument();
  });
});

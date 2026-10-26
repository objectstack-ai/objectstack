/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The granular confirm-before-change card (`status:'changes_proposed'`).
 *
 * Every string on this card — heading, buttons, hint, and the verb column of
 * each change row — was a hard-coded Chinese literal until objectui#2884, so an
 * English user read the whole confirm gate in Chinese. Worse, the confirm
 * button SENT a Chinese sentence to the agent, which flips the agent's reply
 * language for the rest of the thread.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const CJK = /[一-鿿]/;

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
            changes: [
              { verb: 'add_field', object: 'task', field: 'priority', type: 'select' },
              { verb: 'delete_field', object: 'task', field: 'legacy_code' },
            ],
          },
        },
      ],
    },
  ];
}

describe('ChatbotEnhanced — confirm-before-change card', () => {
  it('renders every label in English by default, with no CJK anywhere on the card', () => {
    render(<ChatbotEnhanced messages={changesMessage()} onSendMessage={vi.fn()} />);

    const card = screen.getByTestId('proposed-changes');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('Confirm changes')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('Confirm');
    expect(screen.getByTestId('proposed-changes-adjust')).toHaveTextContent('Adjust');

    // The verb column — the part that used to read 新增字段 / 删除字段.
    expect(card).toHaveTextContent('Add field task.priority (select)');
    expect(card).toHaveTextContent('Delete field task.legacy_code');

    expect(card.textContent ?? '').not.toMatch(CJK);
  });

  it('sends an English confirmation, not a Chinese one, from an English surface', () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={changesMessage()} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const sent = onSendMessage.mock.calls[0][0] as string;
    // The bug: this used to be '确认修改，应用你刚才提议的改动。' unconditionally,
    // so clicking Confirm in an English session told the agent — in Chinese —
    // to apply the changes, and the agent answered in Chinese from then on.
    expect(sent).not.toMatch(CJK);
    expect(sent).toMatch(/^Confirm\b/i);
  });

  it('honours caller-supplied labels and confirm message (the console passes translated ones)', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={changesMessage()}
        onSendMessage={onSendMessage}
        changesTitleLabel="确认改动"
        changesConfirmLabel="确认修改"
        planAdjustLabel="调整"
        changesConfirmMessage="确认修改，应用你刚才提议的改动。"
        changeVerbLabels={{ add_field: '新增字段', delete_field: '删除字段' }}
      />,
    );

    const card = screen.getByTestId('proposed-changes');
    expect(card).toHaveTextContent('新增字段 task.priority');
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('确认修改');

    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(onSendMessage).toHaveBeenCalledWith('确认修改，应用你刚才提议的改动。');
  });

  it('falls back to the English verb name for a verb the caller did not translate', () => {
    render(
      <ChatbotEnhanced
        messages={changesMessage()}
        onSendMessage={vi.fn()}
        changeVerbLabels={{ add_field: '新增字段' }}
      />,
    );
    // `delete_field` is absent from the supplied map — it must not render as
    // the raw `delete_field` token.
    expect(screen.getByTestId('proposed-changes')).toHaveTextContent('Delete field task.legacy_code');
  });

  it('shows the reply hint instead of buttons when there is no send handler', () => {
    render(<ChatbotEnhanced messages={changesMessage()} />);
    expect(screen.queryByTestId('proposed-changes-actions')).not.toBeInTheDocument();
    expect(screen.getByText('Reply to confirm or adjust this change.')).toBeInTheDocument();
  });
});

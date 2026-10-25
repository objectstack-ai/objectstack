// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reloaded multi-step build no longer paints an empty 「执行过程」 block under
 * every step (objectui#10899 item 5).
 *
 * The conversation store persists each step of an agent turn as its own
 * assistant row, whose only text is the placeholder `(called verify_build)`, so
 * a reloaded build hydrates into one message per step. Measured on the
 * 2026-09-28 local E2E (both the in-app dock and the Studio copilot): each step
 * rendered its tool row (「校验搭建结果 · 已完成」), THEN the italic 执行过程
 * note, THEN the message action bar — invisible (`opacity-0`) but full height —
 * so every step read as an empty block with a large blank area.
 *
 * Two rules now, both pinned here against the real `ChatbotEnhanced`:
 *   - the 执行过程 note is the fallback for a placeholder turn that shows
 *     NOTHING else; a turn whose tool row is on screen does not repeat it;
 *   - the copy / regenerate bar renders only for a turn with visible prose —
 *     there is nothing else to copy, and Copy would copy the placeholder.
 * The #772 fallback (a placeholder turn with no tool row keeps the note) and a
 * prose turn's action bar are the controls.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const NOTE = 'AGENT_ACTIVITY_NOTE';

/** One hydrated step turn: the placeholder text + the step's completed tool. */
function stepTurn(id: string, toolName: string): ChatbotEnhancedMessage {
  return {
    id,
    role: 'assistant',
    content: `(called ${toolName})`,
    toolInvocations: [{ toolCallId: `${id}-call`, toolName, state: 'output-available' }],
  };
}

describe('hydrated step turns (objectui#10899)', () => {
  it('a step turn whose tool row is shown gets no 执行过程 note and no action bar', () => {
    render(
      <ChatbotEnhanced
        labels={{ agentActivity: NOTE, copy: 'COPY_ACTION' }}
        messages={[
          { id: 'u1', role: 'user', content: '确认，开始搭建。' },
          stepTurn('a1', 'verify_build'),
          stepTurn('a2', 'todo_write'),
          { id: 'a3', role: 'assistant', content: '客户管理应用已搭建完成并通过校验。' },
        ]}
      />,
    );

    // The steps' activity is on screen — as tool rows, not as notes.
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByText('(called verify_build)')).toBeNull();
    // Exactly one action bar: the final prose turn's.
    expect(screen.getAllByText('COPY_ACTION')).toHaveLength(1);
    expect(screen.getByText('客户管理应用已搭建完成并通过校验。')).toBeInTheDocument();
  });

  it('CONTROL (#772) — a placeholder turn with NO tool row still shows the quiet note', () => {
    render(
      <ChatbotEnhanced
        labels={{ agentActivity: NOTE, copy: 'COPY_ACTION' }}
        messages={[{ id: 'a1', role: 'assistant', content: '(called suggest_builder)' }]}
      />,
    );
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByText('(called suggest_builder)')).toBeNull();
    // Still nothing to copy on it.
    expect(screen.queryByText('COPY_ACTION')).toBeNull();
  });

  it('CONTROL — a prose turn keeps its action bar, with or without tools', () => {
    render(
      <ChatbotEnhanced
        labels={{ agentActivity: NOTE, copy: 'COPY_ACTION' }}
        messages={[
          { id: 'a1', role: 'assistant', content: 'Here is the summary.' },
          {
            id: 'a2',
            role: 'assistant',
            content: 'Checked the build.',
            toolInvocations: [{ toolCallId: 'c2', toolName: 'verify_build', state: 'output-available' }],
          },
        ]}
      />,
    );
    expect(screen.getAllByText('COPY_ACTION')).toHaveLength(2);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

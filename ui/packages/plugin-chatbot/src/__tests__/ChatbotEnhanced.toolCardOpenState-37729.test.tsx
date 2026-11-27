/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A tool card the user opened or closed by hand keeps that state when the
 * conversation re-renders around it (a new message arrives, the host passes
 * fresh props). The card's open state lives in its own collapsible, so the
 * card must keep the same element identity across renders: the same element
 * type at the same `key={tool.toolCallId}`, never a remount.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const QUESTION: ChatbotEnhancedMessage = { id: 'u1', role: 'user', content: 'Show me three deals' };

const TURN: ChatbotEnhancedMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'Found 3 deals.',
  toolInvocations: [
    {
      // Completed: the card starts closed.
      toolCallId: 'tc_done',
      toolName: 'query_data',
      args: { objectName: 'deal', limit: 3 },
      result: { count: 3 },
      state: 'output-available',
    },
    {
      // Failed: the card starts open.
      toolCallId: 'tc_failed',
      toolName: 'list_objects',
      args: {},
      errorText: 'Object service unavailable',
      state: 'output-error',
    },
  ],
};

const FOLLOW_UP: ChatbotEnhancedMessage[] = [
  { id: 'u2', role: 'user', content: 'And the biggest one?' },
  { id: 'a2', role: 'assistant', content: 'The biggest deal is ACME.' },
];

/** The collapsible trigger of the card whose title is `title`. */
function cardTrigger(title: string): HTMLElement {
  const trigger = screen.getByText(title).closest('button');
  if (!trigger) throw new Error(`no card trigger for "${title}"`);
  return trigger;
}

describe('ChatbotEnhanced — a tool card keeps the open state the user chose across a re-render', () => {
  it('a card the user expanded stays expanded, and one the user collapsed stays collapsed, after a message is appended', () => {
    const { rerender } = render(
      <ChatbotEnhanced processVisibility="debug" messages={[QUESTION, TURN]} toolDecisions={{}} />,
    );

    // The starting states the cards choose for themselves.
    expect(cardTrigger('Query data')).toHaveAttribute('aria-expanded', 'false');
    expect(cardTrigger('List objects')).toHaveAttribute('aria-expanded', 'true');

    // The user flips both.
    fireEvent.click(cardTrigger('Query data'));
    fireEvent.click(cardTrigger('List objects'));
    expect(cardTrigger('Query data')).toHaveAttribute('aria-expanded', 'true');
    expect(cardTrigger('List objects')).toHaveAttribute('aria-expanded', 'false');

    // The parent re-renders: two more messages and a fresh props object.
    rerender(
      <ChatbotEnhanced
        processVisibility="debug"
        messages={[QUESTION, TURN, ...FOLLOW_UP]}
        toolDecisions={{}}
      />,
    );
    expect(screen.getByText('The biggest deal is ACME.')).toBeInTheDocument();

    // Both cards still show what the user chose, not their starting state.
    expect(cardTrigger('Query data')).toHaveAttribute('aria-expanded', 'true');
    expect(cardTrigger('List objects')).toHaveAttribute('aria-expanded', 'false');
  });
});

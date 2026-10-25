/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7480 — the in-app assistant rail stayed parked on the previous
 * reply after a send: the new user bubble, the tool steps and the streaming
 * answer all landed below the fold with nothing on screen saying the agent had
 * started.
 *
 * The surprising part of that report is that the full-page maker and the rail
 * are the SAME component (`ChatPane` → this one → `Conversation`), so there was
 * no divergent code to reconcile. What differs is width: `StickToBottom` only
 * auto-follows while the view is at the bottom, and in a ~360px rail a reply is
 * two or three times taller than in the full-page column — so by the time the
 * user has read it the lock is escaped, and the next send appends off-screen.
 *
 * Sending is an explicit request to see what comes next, so every send path
 * re-arms the lock. This suite pins that, and — just as load-bearing — pins
 * that a mere message APPEND does not, which is what keeps a user reading back
 * through the thread mid-answer from being yanked to the bottom.
 *
 * `../elements/conversation` is mocked so the `contextRef` handed to
 * `<Conversation>` is observable. That vendored ai-elements file is not edited
 * by this change: `contextRef` is `StickToBottom`'s own escape hatch and flows
 * through its prop spread.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/** The scroll control the component reaches for on every send. */
const scrollToBottom = vi.fn();
/** Whether `ChatbotEnhanced` handed `<Conversation>` a `contextRef` at all. */
let sawContextRef = false;

vi.mock('../elements/conversation', () => {
  const Conversation = ({
    children,
    contextRef,
  }: {
    children?: React.ReactNode;
    contextRef?: React.MutableRefObject<unknown> | ((v: unknown) => void);
  }) => {
    sawContextRef = Boolean(contextRef);
    // Publish a stand-in context exactly as `StickToBottom` does.
    const ctx = { scrollToBottom, stopScroll: vi.fn(), isAtBottom: false, escapedFromLock: true };
    if (typeof contextRef === 'function') contextRef(ctx);
    else if (contextRef) contextRef.current = ctx;
    return <div data-testid="conversation">{children}</div>;
  };
  return {
    Conversation,
    ConversationContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ConversationEmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ConversationScrollButton: () => null,
  };
});

const { ChatbotEnhanced } = await import('../ChatbotEnhanced');
type ChatbotEnhancedMessage = import('../ChatbotEnhanced').ChatbotEnhancedMessage;

beforeEach(() => {
  scrollToBottom.mockClear();
  sawContextRef = false;
});

async function submit(text: string, onSendMessage: () => void) {
  const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.submit(textarea.closest('form')!);
  // prompt-input calls onSubmit in a microtask (after blob conversion).
  await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
}

describe('ChatbotEnhanced follows the thread when the user SENDS (objectui#7480)', () => {
  it('hands the conversation a contextRef at all', () => {
    render(<ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} />);
    expect(sawContextRef).toBe(true);
  });

  it('scrolls to the bottom after a typed send', async () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} />);
    await submit('build me a CRM', onSendMessage);
    await waitFor(() => expect(scrollToBottom).toHaveBeenCalled());
  });

  it('scrolls after a start-chip send too', async () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        suggestions={['Build a sales CRM']}
      />,
    );
    fireEvent.click(screen.getByText('Build a sales CRM'));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('Build a sales CRM'));
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it('does NOT scroll when messages merely arrive — the user may have scrolled up', async () => {
    const onSendMessage = vi.fn();
    const first: ChatbotEnhancedMessage[] = [{ id: 'm1', role: 'user', content: 'hello' } as ChatbotEnhancedMessage];
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} messages={first} />,
    );
    scrollToBottom.mockClear();

    // A streaming append, and then another — the shape of an assistant reply
    // growing token by token. `StickToBottom` owns whether to follow these; the
    // component must not force it, or reading back through the thread while the
    // answer streams would keep snapping the view to the bottom.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        messages={[...first, { id: 'm2', role: 'assistant', content: 'wor' } as ChatbotEnhancedMessage]}
      />,
    );
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        messages={[...first, { id: 'm2', role: 'assistant', content: 'working on it' } as ChatbotEnhancedMessage]}
      />,
    );
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});

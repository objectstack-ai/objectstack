/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#32984 item 2 — a message typed while a turn runs is queued in
 * sight and sent when the turn ends, never dropped. Every interaction goes
 * through the rendered component (Enter in the textarea, a click on the
 * button), so the input pipeline runs as it does in the console.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

describe('objectstack#32984 item 2 — a message typed during a turn is never dropped', () => {
  it('Enter during a turn queues it in sight, and it is sent when the turn ends', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    // The composer is live during the turn: the user can type.
    expect(textarea).not.toBeDisabled();
    fireEvent.change(textarea, { target: { value: '在哪里打开这个应用？' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const queued = await screen.findByTestId('composer-queued-item');
    expect(queued).toHaveTextContent('在哪里打开这个应用？');
    expect(queued).toHaveTextContent('Sends when the current reply finishes');
    expect(onSendMessage).not.toHaveBeenCalled();

    // The turn ends: the queued message goes out, once, and leaves the queue.
    rerender(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith('在哪里打开这个应用？', undefined);
    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
  });

  it('Cancel takes it out of the queue and puts the text back in the box', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'never mind' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('composer-queued-cancel'));

    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
    expect(textarea.value).toBe('never mind');
    rerender(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('control: with no turn running, Enter sends at once', async () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage.mock.calls[0][0]).toBe('hello');
    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
  });
});

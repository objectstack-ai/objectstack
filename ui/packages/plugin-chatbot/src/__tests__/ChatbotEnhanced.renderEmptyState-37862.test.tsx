/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#37862 — `renderEmptyState`: the host's own empty conversation,
 * drawn in place of the built-in one while the conversation has no message.
 * It gets two actions: `send` sends a text as a built-in suggestion chip does,
 * `fill` puts it in the composer and focuses it, sending nothing.
 *
 * Real subject: the real `ChatbotEnhanced` with its real composer; the host
 * render function and `onSendMessage` are the inputs.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

type Actions = { send: (text: string) => void; fill: (text: string) => void };

function host() {
  return (actions: Actions) => (
    <div data-testid="host-empty">
      <button type="button" onClick={() => actions.send('Count my deals')}>
        send-one
      </button>
      <button type="button" onClick={() => actions.fill('Summarize this record')}>
        fill-one
      </button>
    </div>
  );
}

describe('ChatbotEnhanced renderEmptyState (objectstack#37862)', () => {
  it('draws the host empty state instead of the built-in one, suggestions included', () => {
    render(
      <ChatbotEnhanced
        messages={[]}
        suggestions={['Built-in chip']}
        labels={{ emptyTitle: 'Built-in title' }}
        renderEmptyState={host()}
      />,
    );
    expect(screen.getByTestId('host-empty')).toBeInTheDocument();
    expect(screen.queryByText('Built-in title')).not.toBeInTheDocument();
    expect(screen.queryByText('Built-in chip')).not.toBeInTheDocument();
  });

  it('control: without it the built-in empty state is drawn', () => {
    render(<ChatbotEnhanced messages={[]} labels={{ emptyTitle: 'Built-in title' }} />);
    expect(screen.getByText('Built-in title')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-empty-state-host')).not.toBeInTheDocument();
  });

  it('is not drawn once the conversation has a message', () => {
    render(
      <ChatbotEnhanced
        messages={[{ id: 'm1', role: 'user', content: 'hello' }]}
        renderEmptyState={host()}
      />,
    );
    expect(screen.queryByTestId('host-empty')).not.toBeInTheDocument();
  });

  it('send: the text goes out as a message', () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} renderEmptyState={host()} />);
    fireEvent.click(screen.getByRole('button', { name: 'send-one' }));
    expect(onSendMessage).toHaveBeenCalledWith('Count my deals');
  });

  it('fill: the text lands in the focused composer, the host hears the change, and nothing is sent', () => {
    const onSendMessage = vi.fn();
    const onInputChange = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[]}
        onSendMessage={onSendMessage}
        onInputChange={onInputChange}
        renderEmptyState={host()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'fill-one' }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Summarize this record');
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe('Summarize this record'.length);
    expect(onInputChange).toHaveBeenLastCalledWith('Summarize this record');
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('fill replaces what the composer held', () => {
    render(<ChatbotEnhanced messages={[]} renderEmptyState={host()} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'half a question' } });
    fireEvent.click(screen.getByRole('button', { name: 'fill-one' }));
    expect(textarea.value).toBe('Summarize this record');
  });
});

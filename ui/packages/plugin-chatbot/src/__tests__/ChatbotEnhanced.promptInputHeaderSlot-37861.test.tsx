/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#37861 — the host's context chip inside the input's frame.
 *
 * The record a conversation is about is drawn as a chip at the start of the
 * composer's line, inside its frame, with its own remove control. The frame
 * had one text-only chip (`surfaceContextLabel`) there and no slot a host
 * could fill; the row above the input (`promptHeaderSlot`) is outside the
 * frame. `promptInputHeaderSlot` is that slot.
 *
 * Pinned: given, it renders inside the form's input group, before the
 * textarea, and takes the place of the text chip; absent, the frame draws the
 * text chip exactly as before.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

describe('ChatbotEnhanced promptInputHeaderSlot (objectstack#37861)', () => {
  it('draws the slot inside the input frame, before the input, in place of the page chip', () => {
    render(
      <ChatbotEnhanced
        surfaceContextLabel="Viewing: Account"
        promptInputHeaderSlot={<button type="button" data-testid="host-chip">Acme ×</button>}
      />,
    );
    const slot = screen.getByTestId('prompt-input-header-slot');
    const hostChip = screen.getByTestId('host-chip');
    expect(slot).toContainElement(hostChip);
    expect(screen.queryByTestId('surface-context-chip')).toBeNull();

    const textarea = screen.getByRole('textbox');
    const frame = textarea.closest('.group\\/input-group');
    expect(frame).not.toBeNull();
    expect(frame).toContainElement(slot);
    // Before the input in the frame's own order: the start of the line.
    expect(slot.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not the row above the frame.
    expect(screen.queryByTestId('prompt-header-slot')).toBeNull();
  });

  it('absent, the frame draws the page chip as before', () => {
    render(<ChatbotEnhanced surfaceContextLabel="Viewing: Account" />);
    expect(screen.getByTestId('surface-context-chip')).toHaveTextContent('Viewing: Account');
    expect(screen.queryByTestId('prompt-input-header-slot')).toBeNull();
  });

  it('the new prop does not leak onto the DOM as an unknown attribute', () => {
    const { container } = render(<ChatbotEnhanced promptInputHeaderSlot={<span>x</span>} />);
    expect(container.querySelector('[promptinputheaderslot]')).toBeNull();
  });
});

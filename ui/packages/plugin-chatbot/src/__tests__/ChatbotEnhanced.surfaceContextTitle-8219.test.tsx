/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#8219 item 3 — the "discussing" chip above the composer.
 *
 * objectui#7254 ruled where an internal identity may appear: what is READ is
 * the display label, and the internal `type · name` pair stays REACHABLE on a
 * tooltip. The chip had a text slot (`surfaceContextLabel`) and no tooltip
 * slot, so a host could only print the pair at the reader or drop it. The
 * optional `surfaceContextTitle` prop is that tooltip slot.
 *
 * Pinned both ways: a host that passes the new prop gets it as the chip's
 * `title`; a host that does not renders the chip exactly as before — the same
 * text and no attribute beyond the one it always had.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

/** The visible pill inside the chip row. */
function chipPill(): HTMLElement {
  const row = screen.getByTestId('surface-context-chip');
  const pill = row.firstElementChild;
  if (!(pill instanceof HTMLElement)) throw new Error('surface-context-chip has no pill element');
  return pill;
}

describe('ChatbotEnhanced surface-context chip tooltip (objectui#8219)', () => {
  it('renders surfaceContextTitle as the chip tooltip, beside the label it reads', () => {
    render(
      <ChatbotEnhanced
        surfaceContextLabel="Discussing: Customer dashboard"
        surfaceContextTitle="dashboard · customer_dashboard"
      />,
    );
    const pill = chipPill();
    expect(pill).toHaveTextContent('Discussing: Customer dashboard');
    expect(pill).toHaveAttribute('title', 'dashboard · customer_dashboard');
    // The pair is reachable, not printed.
    expect(pill.textContent).not.toContain('customer_dashboard');
  });

  it('without surfaceContextTitle the chip renders as before: same text, no title, no new attribute', () => {
    render(<ChatbotEnhanced surfaceContextLabel="Discussing: dashboard · customer_dashboard" />);
    const pill = chipPill();
    expect(pill).toHaveTextContent('Discussing: dashboard · customer_dashboard');
    expect(pill).not.toHaveAttribute('title');
    expect(pill.getAttributeNames()).toEqual(['class']);
  });

  it('the new prop does not leak onto the root element as an unknown DOM attribute', () => {
    const { container } = render(
      <ChatbotEnhanced surfaceContextLabel="Discussing: X" surfaceContextTitle="dashboard · x" />,
    );
    expect(container.querySelector('[surfacecontexttitle]')).toBeNull();
    expect(container.querySelector('[surfaceContextTitle]')).toBeNull();
  });

  it('no label means no chip, even when a title is supplied', () => {
    render(<ChatbotEnhanced surfaceContextTitle="dashboard · x" />);
    expect(screen.queryByTestId('surface-context-chip')).not.toBeInTheDocument();
  });
});

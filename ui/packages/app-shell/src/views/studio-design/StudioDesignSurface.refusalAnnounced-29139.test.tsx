// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29139 — every Studio refusal is announced to assistive tech.
 *
 * `StudioRefusalStrip` is the one strip every pillar draws for a refused save
 * or load (the Interfaces leaf and nav, the Data object, the Automations flow,
 * the publish sheet's rows), so the property is pinned on the strip itself:
 *  - the sentence is a `role="alert"`, and the alert's text is the sentence
 *    verbatim, nothing added: what a screen reader reads is what the server or
 *    the designer said;
 *  - "Show me" and the Details disclosure sit outside the alert, so neither is
 *    read as part of the sentence, and opening Details adds nothing to it;
 *  - one strip is one alert.
 *
 * The pillar path the card reproduced (the flow ledger switch's refusal) is
 * pinned in `AutomationsPillar.ledgerSwitch-28148.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { StudioRefusalStrip } from './StudioDesignSurface';

afterEach(cleanup);

const SENTENCE = 'The field “Status” needs at least one option.';

describe('StudioRefusalStrip — the refusal is announced (objectstack#29139)', () => {
  it.each([
    ['a one-line refusal', SENTENCE],
    // A batch publish refusal is several lines (`whitespace-pre-line`).
    ['a refusal of several lines', 'Nothing was published — the batch rolled back (all-or-nothing).\nflow/approval — Title is required.'],
  ])('%s is one alert inside the strip, its text the sentence verbatim', (_label, message) => {
    render(<StudioRefusalStrip refusal={{ message }} locale="en" />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe(message);
    expect(alerts[0]).toHaveAttribute('data-testid', 'studio-refusal-message');
    expect(screen.getByTestId('studio-refusal')).toContainElement(alerts[0]);
  });

  it('keeps "Show me" and Details out of the alert, before and after Details opens', () => {
    const onShow = vi.fn();
    render(
      <StudioRefusalStrip
        refusal={{
          message: SENTENCE,
          target: { kind: 'field', id: 'status' },
          input: 'Options',
          detail: 'fields.status.options — Array must contain at least 1 element(s)',
        }}
        locale="en"
        onShow={onShow}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(SENTENCE);
    // The strip's controls are reachable, and none is inside the alert.
    const show = screen.getByRole('button', { name: 'Show me' });
    expect(alert).not.toContainElement(show);
    expect(within(alert).queryByRole('button')).toBeNull();
    const details = screen.getByTestId('studio-refusal-detail');
    expect(alert).not.toContainElement(details);

    fireEvent.click(within(details).getByText('Details'));
    (details as HTMLDetailsElement).open = true;
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE);

    fireEvent.click(show);
    expect(onShow).toHaveBeenCalledWith({ kind: 'field', id: 'status' }, 'Options');
  });
});

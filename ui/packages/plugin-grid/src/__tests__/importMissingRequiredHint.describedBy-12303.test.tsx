/**
 * objectui#12303 row 5 — the import wizard's disabled "Next" is described by
 * the "Can't continue" text that says why.
 *
 * Measured on the card: with a required column unmapped, the mapping step
 * showed "Can't continue — required field(s) not mapped: …" (#2640), but the
 * disabled, non-focusable Next carried no `aria-describedby` and no `title`,
 * so the text was only something that sat above it. Next is now described by
 * that visible text, and — the record page's Archive pattern
 * (`DeclaredActionsBar`, objectui#11811) — a wrapping span is the tab stop a
 * disabled button cannot be, described by the same text. The text itself is
 * unchanged: the fix associates it, it does not re-word it.
 *
 * The harness is `importMissingRequiredHint.test.tsx`'s: the real wizard, and
 * a pasted table that omits the required `status` column.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '../ImportWizard';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'status', label: 'Lifecycle', type: 'text', required: true },
];

function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

// A source offering none of the optional import capabilities (see the sibling suite).
const NO_CAPABILITY_DATA_SOURCE = {};

function renderWizard() {
  render(
    <ImportWizard
      objectName="account"
      fields={FIELDS}
      dataSource={NO_CAPABILITY_DATA_SOURCE}
      open
      onOpenChange={() => {}}
    />,
  );
}

/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('ImportWizard mapping step — the disabled Next is described by its reason (objectui#12303)', () => {
  it('Next and its focusable wrapper are both described by the visible "Can’t continue" text', async () => {
    renderWizard();
    pasteRows('Name\nAcme');

    const hint = await screen.findByTestId('import-missing-required');
    const next = screen.getByTestId('import-next-btn');
    expect(next).toBeDisabled();
    const reason = describedBy(next);
    expect(reason).not.toBeNull();
    // The visible hint's own text, not a copy of it.
    expect(hint).toContainElement(reason);
    expect(reason).toHaveTextContent('Lifecycle (status)');
    expect(reason).toBeVisible();

    const wrapper = next.parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute('data-disabled-reason');
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(describedBy(wrapper)).toBe(reason);
  });

  it('a keyboard user reaches it: Tab from Back lands on the described wrapper', async () => {
    const user = userEvent.setup();
    renderWizard();
    pasteRows('Name\nAcme');
    await screen.findByTestId('import-missing-required');

    screen.getByRole('button', { name: 'Back' }).focus();
    await user.tab();
    const wrapper = screen.getByTestId('import-next-btn').parentElement as HTMLElement;
    expect(wrapper).toHaveFocus();
    expect(describedBy(wrapper)).toHaveTextContent('Lifecycle (status)');
  });

  it('CONTROL — once the required column is supplied, Next is live and described by nothing', async () => {
    renderWizard();
    pasteRows('Name\nAcme');
    await screen.findByTestId('import-missing-required');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    pasteRows('Name\tstatus\nAcme\tactive');

    await waitFor(() => {
      expect(screen.queryByTestId('import-missing-required')).not.toBeInTheDocument();
    });
    const next = screen.getByTestId('import-next-btn');
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute('aria-describedby');
    expect(next.parentElement).not.toHaveAttribute('data-disabled-reason');
  });
});

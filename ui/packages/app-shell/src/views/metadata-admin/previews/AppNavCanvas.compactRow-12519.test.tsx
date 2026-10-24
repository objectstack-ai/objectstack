// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12519 — the nav canvas row fits the Studio's 240 px rail.
 *
 * A row is a 32 px card holding the drag handle, the label, the kind chip and
 * the remove control. The api name (the record the entry targets) moved from
 * the row into the card's `title`; the remove control is always drawn, at a
 * fixed 24 px, so it is in the document and visible without a hover and
 * showing it never moves the label. A nested row indents by class, not by an
 * inline style.
 *
 * jsdom lays nothing out, so the size and the visibility are read as classes;
 * the rendered widths were read once in Chromium for the pull request and
 * nothing here re-reads them.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppNavCanvas } from './AppNavCanvas';

afterEach(cleanup);

const NAV = [
  { id: 'nav_home', type: 'dashboard', label: 'Support Overview', dashboardName: 'support_overview' },
  {
    id: 'nav_queues',
    type: 'group',
    label: 'Queues',
    children: [{ id: 'nav_mine', type: 'object', label: 'My Open Tickets', objectName: 'desk_ticket' }],
  },
];

function renderCanvas() {
  render(<AppNavCanvas draft={{ navigation: NAV }} rootKey="navigation" onPatch={vi.fn()} selection={null} />);
}

/** The card for `label`: the row button whose text starts with it. */
const card = (label: string) =>
  screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.startsWith(label))!;

describe('objectui#12519 — a nav canvas row fits the 240 px rail', () => {
  it('is a 32 px row: handle, label, kind chip and remove; the api name is on its title, not in it', () => {
    renderCanvas();
    const home = card('Support Overview');
    expect(home.className.split(/\s+/)).toContain('h-8');
    expect(home).toHaveTextContent('dashboard');
    expect(home).not.toHaveTextContent('support_overview');
    expect(home).toHaveAttribute('title', 'Support Overview · support_overview');
    // An entry that targets nothing names only its label.
    expect(card('Queues')).toHaveAttribute('title', 'Queues');
  });

  it('draws the remove control without a hover, at a fixed 24 px, and Tab reaches it after its row', async () => {
    const user = userEvent.setup();
    renderCanvas();
    const home = card('Support Overview');
    const remove = within(home).getByRole('button', { name: 'Remove nav item' });
    const classes = remove.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['h-6', 'w-6', 'shrink-0', 'opacity-50']));
    expect(classes).not.toContain('w-0');
    expect(classes).not.toContain('opacity-0');
    home.focus();
    await user.tab();
    expect(remove).toHaveFocus();
  });

  it('indents a nested row by class, with no inline style', () => {
    renderCanvas();
    const mine = card('My Open Tickets');
    const wrapper = mine.parentElement as HTMLElement;
    expect(wrapper.className.split(/\s+/)).toContain('pl-4');
    expect(wrapper).not.toHaveAttribute('style');
    expect(card('Queues').parentElement).not.toHaveAttribute('style');
  });
});

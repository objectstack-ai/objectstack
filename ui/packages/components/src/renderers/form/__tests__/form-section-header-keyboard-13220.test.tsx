/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13220 — a collapsible form section header is a keyboard-operable
 * disclosure control.
 *
 * A sectioned record form (the Create/Edit dialog, the drawer form) is ONE form
 * whose group headings are inline `section-divider` rows drawn by
 * `SectionDivider`. A collapsible heading used to be a `div[role="button"]`
 * with `aria-expanded` and an `onClick` only: no tab stop and no key handler,
 * so the Tab cycle stepped over it and Enter or Space left a collapsed group
 * closed. Only a mouse could open it.
 *
 * The harness owns the collapse state the way the plugin-form containers do
 * (`resolveSectionCollapse`): the heading row carries `collapsible`,
 * `collapsed` and `onToggle`, and a collapsed group's member is handed over
 * `hidden`, so it is not drawn.
 *
 * Every row drives the page through the keyboard (`user.tab()`,
 * `user.keyboard()`, and `fireEvent.keyDown` where a row needs a key event's
 * `repeat` flag or its default-prevented answer), never a click.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

afterEach(() => cleanup());

// Resolved once, at module scope, after the renderers above have registered:
// `SectionedForm` below is a component, and a component resolved inside its
// render would be a new component type on every render.
const Form = ComponentRegistry.get('form')!;

const field = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name.toUpperCase(),
  type: 'input',
  ...extra,
});

/**
 * A two-group form: `Money` is collapsible and starts collapsed, `Notes` is a
 * plain heading. The collapse state lives here, as it does in `ModalForm`.
 */
function SectionedForm({ onSubmit }: { onSubmit: (data: unknown) => void }) {
  const [collapsed, setCollapsed] = React.useState(true);
  return (
    <Form
      schema={{
        type: 'form',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        onSubmit,
        fields: [
          field('code'),
          {
            name: '__section_money',
            label: 'Money',
            description: 'Budget and spend',
            type: 'section-divider',
            fields: ['budget'],
            colSpan: 4,
            collapsible: true,
            collapsed,
            onToggle: () => setCollapsed((c) => !c),
          },
          field('budget', collapsed ? { hidden: true } : {}),
          {
            name: '__section_notes',
            label: 'Notes',
            type: 'section-divider',
            fields: ['note'],
            colSpan: 4,
          },
          field('note'),
        ],
      }}
    />
  );
}

/** The collapsible `Money` heading, found by its role and accessible name. */
const moneyHeader = () => screen.getByRole('button', { name: /^Money/ });
/** The plain `Notes` heading row. */
const notesRow = () => screen.getByText('Notes').closest('div.col-span-full') as HTMLElement;
const input = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLElement | null;

function setup() {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<SectionedForm onSubmit={onSubmit} />);
  return { user, onSubmit };
}

/** Every element the Tab cycle stops on, from the top of the page until it leaves the form. */
async function tabStops(user: ReturnType<typeof userEvent.setup>): Promise<Element[]> {
  const stops: Element[] = [];
  for (let i = 0; i < 12; i++) {
    await user.tab();
    const el = document.activeElement;
    if (!el || el === document.body || stops.includes(el)) break;
    stops.push(el);
  }
  return stops;
}

describe('objectui#13220 — a collapsible form section header is keyboard-operable', () => {
  it('Tab reaches the collapsed header, between the field above it and the field below the group', async () => {
    const { user } = setup();
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('false');
    expect(input('budget'), 'collapsed: the member is not drawn').toBeNull();

    const stops = await tabStops(user);
    expect(stops).toContain(moneyHeader());
    expect(stops.indexOf(moneyHeader())).toBe(stops.indexOf(input('code')!) + 1);
    expect(stops.indexOf(input('note')!)).toBe(stops.indexOf(moneyHeader()) + 1);
  });

  it('a plain heading is not a Tab stop and carries no control semantics', async () => {
    const { user } = setup();
    const notes = notesRow();
    expect(notes).not.toBeNull();
    expect(notes.getAttribute('role')).toBeNull();
    expect(notes.hasAttribute('tabindex')).toBe(false);
    expect(notes.hasAttribute('aria-expanded')).toBe(false);

    const stops = await tabStops(user);
    // Read off the same Tab cycle that DOES stop on the collapsible header.
    expect(stops).toContain(moneyHeader());
    expect(stops.some((el) => notes.contains(el))).toBe(false);
  });

  it('Enter opens the collapsed group and the next Tab lands on its first field; Enter closes it again', async () => {
    const { user, onSubmit } = setup();
    await user.tab(); // code
    await user.tab(); // Money header
    expect(document.activeElement).toBe(moneyHeader());

    await user.keyboard('{Enter}');
    await waitFor(() => expect(input('budget')).not.toBeNull());
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement, 'focus stays on the header').toBe(moneyHeader());

    await user.tab();
    expect(document.activeElement).toBe(input('budget'));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(moneyHeader());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input('budget')).toBeNull());
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('false');

    expect(onSubmit, 'Enter on the header never submits the form').not.toHaveBeenCalled();
  });

  it('Space opens the collapsed group and closes it again, without submitting the form', async () => {
    const { user, onSubmit } = setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(moneyHeader());

    await user.keyboard(' ');
    await waitFor(() => expect(input('budget')).not.toBeNull());
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('true');

    await user.keyboard(' ');
    await waitFor(() => expect(input('budget')).toBeNull());
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('false');

    expect(onSubmit, 'Space on the header never submits the form').not.toHaveBeenCalled();
  });

  it("Space's default (scrolling the dialog) is prevented, and a held key's auto-repeat does not toggle again", async () => {
    setup();
    const header = moneyHeader();
    header.focus();
    expect(document.activeElement).toBe(header);

    // `fireEvent` returns false when a handler called `preventDefault`.
    expect(fireEvent.keyDown(header, { key: ' ', code: 'Space' })).toBe(false);
    await waitFor(() => expect(input('budget')).not.toBeNull());

    // The auto-repeat keydowns a held key sends after the first one. One key
    // per reading: two toggles would cancel out and read as none.
    expect(fireEvent.keyDown(header, { key: ' ', code: 'Space', repeat: true })).toBe(false);
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('true');
    expect(input('budget')).not.toBeNull();
    fireEvent.keyDown(header, { key: 'Enter', code: 'Enter', repeat: true });
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('true');
    expect(input('budget')).not.toBeNull();

    // Any other key is left alone: not prevented, no toggle.
    expect(fireEvent.keyDown(header, { key: 'a', code: 'KeyA' })).toBe(true);
    expect(moneyHeader().getAttribute('aria-expanded')).toBe('true');
  });

  it('control: Enter in a field still submits, so the no-submit rows above can fail', async () => {
    const { user, onSubmit } = setup();
    await user.click(input('code')!);
    await user.keyboard('X1{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

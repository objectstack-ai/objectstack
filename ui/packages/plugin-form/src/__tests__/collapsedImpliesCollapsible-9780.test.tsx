/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.sections[].collapsed` IMPLIES `collapsible` (objectui#9780,
 * maintainer ruling 2026-09-18, letter A).
 *
 * THE TRAP THIS FILE CLOSES. `collapsed` and `collapsible` are two independent
 * members and every declaration face accepts either one alone. The default
 * grouped layout read `collapsed` for the initial state UNCONDITIONALLY, while
 * it installed the disclosure control only for a section that also wrote
 * `collapsible` — so `collapsed: true` written ALONE rendered a section that
 * starts closed, keeps its fields out of the DOM, and offers nothing on the
 * page that can bring them back, with no error, no warning and no degradation.
 * "Collapsed by default" is an everyday intent and `collapsed: true` is its
 * most natural spelling, which is exactly why it had to become the correct one.
 *
 * ⭐ WHAT THESE ROWS PIN IS THE RULING, NOT MERELY THE OUTCOME. Two other
 * letters were on the table and BOTH are refuted by rows here, so a later
 * change that adopts either goes red rather than quiet:
 *
 *   - letter B — refuse the combination at the declaration face. Row 1 renders
 *     that exact combination and requires the section to be present, openable
 *     and to hand its fields back.
 *   - letter C — keep the behaviour and add a dev-only `console.warn`. Rows 1
 *     and 3 require a CONTROL on the page (`role="button"` + `aria-expanded`
 *     on the divider) and require a click on it to reveal the fields. A
 *     warning-only implementation leaves the section unopenable and fails them
 *     while printing a message no user of the page ever sees.
 *
 * ⚠️ Row 3 is the contradiction case the ruling names explicitly:
 * `collapsible: false` WITH `collapsed: true` resolves the same way —
 * collapsed wins, the toggle is present — so the opposite resolution
 * ("`collapsible: false` suppresses the control") is pinned OUT, not left to
 * the next reader's taste.
 *
 * ⚠️ Row 1 clicks TWICE on purpose. The implication is read off the
 * DECLARATION, never off the live collapse state: an implementation that
 * derived the control from the current state would install it while closed and
 * then delete it the moment the user opened the section — a section that can
 * be opened once and never closed again. The second click is what distinguishes
 * those two implementations.
 *
 * HOW EACH ZERO IS LIT. Every row that asserts fields are ABSENT carries a live
 * control in the SAME call on the SAME instrument: the section heading is drawn
 * (so the section itself was rendered and the reader is not looking at an empty
 * form), and the very same `drawnFields` reader reports the fields NON-empty
 * after the click. Row 4 is the absence control for the control-detector: a
 * section declaring NEITHER member draws its heading, draws its fields and
 * carries no `role="button"` and no `aria-expanded` at all — so the instrument
 * rows 1-3 use to find the toggle is one that can also report none.
 *
 * SCOPE. The default grouped layout only — the layout a section-carrying form
 * gets when it declares no `formType`. Sibling layouts synthesize their own
 * divider rows and are not this file's subject.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/** Mount the DEFAULT grouped layout (no `formType`) and wait for its `<form>`. */
async function groupedForm(section: Record<string, unknown>): Promise<HTMLElement> {
  render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: 'invoice',
          mode: 'create',
          sections: [{ label: 'Money', fields: ['amount'], ...section }],
        } as any
      }
      dataSource={makeDataSource()}
    />,
  );
  let form: HTMLFormElement | null = null;
  await waitFor(() => {
    form = document.body.querySelector('form');
    if (!form) throw new Error('form not ready');
  });
  return form as unknown as HTMLElement;
}

/** The section headings actually drawn, in DOM order. */
const headings = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('.border-b span')].map((el) => el.textContent ?? '');

/** The field controls actually drawn, in DOM order. */
const drawnFields = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

/**
 * The disclosure controls on the page: the divider rows a user can actually
 * click. `SectionDivider` renders `role="button"` and `aria-expanded` only when
 * it was handed `collapsible`, so this reader finds a control exactly when one
 * exists.
 */
const toggles = (f: HTMLElement): HTMLElement[] => [
  ...f.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]'),
];

/** `aria-expanded` of the one disclosure control, or `null` when there is none. */
const expanded = (f: HTMLElement): string | null =>
  toggles(f)[0]?.getAttribute('aria-expanded') ?? null;

describe('`object-form` grouped layout — `sections[].collapsed` implies `collapsible` (objectui#9780)', () => {
  it('1. `collapsed: true` ALONE — starts closed, and a control on the page opens it again', async () => {
    const f = await groupedForm({ collapsed: true });

    expect(
      headings(f),
      'the live control: the section itself is rendered, so the empty field list below is a reading',
    ).toEqual(['Money']);
    expect(
      drawnFields(f),
      'the authored intent is honoured — the section starts closed, its fields out of the DOM',
    ).toEqual([]);
    expect(
      toggles(f),
      '⭐ THE CARD: before the ruling this was empty — a permanently closed section with ' +
        'nothing on the page able to reopen it. A dev-only warning (letter C) leaves it empty too',
    ).toHaveLength(1);
    expect(expanded(f), 'and the control reports the state it is in').toBe('false');

    fireEvent.click(toggles(f)[0]);
    await waitFor(() => {
      expect(
        drawnFields(f),
        'clicking the control hands the fields back — the same reader that reported none above',
      ).toEqual(['amount']);
    });
    expect(expanded(f)).toBe('true');

    expect(
      toggles(f),
      '⚠️ the implication is read off the DECLARATION, not off the live state: opening the ' +
        'section must not delete the control that closes it again',
    ).toHaveLength(1);
    fireEvent.click(toggles(f)[0]);
    await waitFor(() => {
      expect(drawnFields(f), 'so the section closes again, as many times as the user likes').toEqual([]);
    });
  });

  it('2. `collapsible: true` ALONE — UNCHANGED: open, with the control present', async () => {
    const f = await groupedForm({ collapsible: true });

    expect(headings(f)).toEqual(['Money']);
    expect(
      drawnFields(f),
      'nothing about this spelling moved: no `collapsed` is declared, so the section starts open',
    ).toEqual(['amount']);
    expect(toggles(f), 'and it has had a control all along').toHaveLength(1);
    expect(expanded(f)).toBe('true');

    fireEvent.click(toggles(f)[0]);
    await waitFor(() => {
      expect(drawnFields(f), 'which still closes it').toEqual([]);
    });
    expect(expanded(f)).toBe('false');
  });

  it('3. `collapsible: false` WITH `collapsed: true` — collapsed wins, the toggle is present', async () => {
    const f = await groupedForm({ collapsible: false, collapsed: true });

    expect(
      headings(f),
      'the live control for the empty field list below',
    ).toEqual(['Money']);
    expect(
      drawnFields(f),
      'the ruling resolves the contradiction in favour of `collapsed`',
    ).toEqual([]);
    expect(
      toggles(f),
      '⚠️ and therefore the control is installed DESPITE the explicit `collapsible: false` — ' +
        'the opposite resolution would leave the author with an unopenable section again',
    ).toHaveLength(1);
    expect(expanded(f)).toBe('false');

    fireEvent.click(toggles(f)[0]);
    await waitFor(() => {
      expect(drawnFields(f), 'so these fields are reachable too').toEqual(['amount']);
    });
  });

  it('4. absence control — a section declaring NEITHER member draws no disclosure control', async () => {
    const f = await groupedForm({});

    expect(headings(f)).toEqual(['Money']);
    expect(drawnFields(f), 'an ordinary section, open as it always was').toEqual(['amount']);
    expect(
      toggles(f),
      'the reader rows 1-3 use to find the toggle CAN report none, so their hits are readings ' +
        'and the implication did not turn every section into a collapsible one',
    ).toEqual([]);
    expect(expanded(f)).toBeNull();
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three `ComboboxSchema` members objectui#8140 measured, each pinned in the
 * state the measurement put it in — and the two facts the third one's
 * RETIREMENT rests on, so the retirement cannot quietly outlive its premise.
 *
 * ## Why the card's count of three unread keys was itself a count, not a reading
 *
 * The card reported `name`, `defaultValue` and `description` as having "0 read
 * sites on the combobox path", derived from grepping this renderer for
 * `schema.<key>`. That spelling is absent for all three. Only two of them are
 * actually undelivered:
 *
 *  - `name` ALREADY REACHES THE DOM. `SchemaRenderer` spreads every
 *    non-metadata top-level schema key as a React prop, and `name` is one of
 *    the two keys `FORM_CONTROL_DOM_PASS_THROUGH_KEYS` adds to the SDUI
 *    baseline for exactly this class of host. It survives
 *    `toFormControlDomProps` and lands on the focusable trigger. The remedy for
 *    a key that is delivered by a mechanism instead of by a spelling is a PIN,
 *    not a second carrier — adding `name={schema.name}` would be the
 *    two-carriers-for-one-question shape objectui#7238 removed for `disabled`.
 *  - `description` was genuinely undelivered and is honoured here, wired with
 *    `aria-describedby` rather than left as a loose paragraph (objectui#5735).
 *  - `defaultValue` was genuinely undelivered and is RETIRED on both faces
 *    (`@object-ui/types`' `combobox-default-value-retired-8140.test.ts` pins
 *    the contract). The two premises that decision rests on are measured here.
 *
 * ⛔ `label` and `error` are NOT in scope and must not be swept in: they are
 * declared on `ComboboxSchema` and unrendered here too, but for a reason this
 * card did not measure and did not settle.
 *
 * ## The negatives all carry controls
 *
 * "No `aria-describedby`" and "no combobox rendered" both pass on a build that
 * rendered nothing at all, so every negative below is paired with a positive on
 * the same instrument.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook — the cold transform must not be billed to
// `hookTimeout` (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

afterEach(cleanup);

const OPTIONS = [
  { value: 'cn', label: 'China' },
  { value: 'us', label: 'United States' },
];

const renderNode = (node: Record<string, unknown>) =>
  render(<SchemaRenderer schema={{ type: 'combobox', options: OPTIONS, ...node } as any} />);

/** The focusable trigger — the element a user and their screen reader touch. */
const trigger = (): HTMLElement => screen.getByRole('combobox');

/**
 * The description relationship resolved the way assistive tech resolves it:
 * read `aria-describedby`, look every id up, return the resolved text. A
 * DANGLING id throws rather than being skipped — an attribute naming an element
 * that does not exist is worse than no attribute (objectui#5735's discipline).
 */
function describedTexts(el: HTMLElement): string[] {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => {
    const found = el.ownerDocument.getElementById(id);
    if (!found) throw new Error(`aria-describedby names "${id}", which is not in the document`);
    return found.textContent ?? '';
  });
}

/* ── `name` — delivered already, pinned so it cannot regress silently ─────── */

describe('`name` reaches the trigger (objectui#8140)', () => {
  it('lands on the focusable `role="combobox"` button', () => {
    renderNode({ id: 'cb', name: 'country' });
    expect(trigger()).toHaveAttribute('name', 'country');
  });

  it('CONTROL — a node that authors no `name` has no `name` attribute, so the assertion above is about the key', () => {
    renderNode({ id: 'cb' });
    expect(trigger().hasAttribute('name')).toBe(false);
  });
});

/* ── `description` — newly honoured, and ASSOCIATED ───────────────────────── */

describe('`description` is rendered and announced (objectui#8140)', () => {
  it('renders the help text below the control', () => {
    renderNode({ id: 'cb', description: 'Where you live' });
    expect(screen.getByText('Where you live')).toBeInTheDocument();
  });

  it('ties it to the trigger, so it is the control‘s accessible DESCRIPTION and not loose decoration', () => {
    renderNode({ id: 'cb', description: 'Where you live' });
    expect(describedTexts(trigger())).toEqual(['Where you live']);
    expect(trigger()).toHaveAccessibleDescription('Where you live');
  });

  it('leaves NO `aria-describedby` when no description is authored — a dangling id is worse than none', () => {
    renderNode({ id: 'cb' });
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
  });

  it('COMPOSES with an author-supplied `aria-describedby` instead of overwriting it', () => {
    render(
      <>
        <p id="authored-note">Read the policy first</p>
        <SchemaRenderer
          schema={{ type: 'combobox', id: 'cb', options: OPTIONS, description: 'Where you live', 'aria-describedby': 'authored-note' } as any}
        />
      </>,
    );
    expect(describedTexts(trigger())).toEqual(['Read the policy first', 'Where you live']);
  });

  it('CONTROL — the author-supplied id survives on its own when no description is authored', () => {
    render(
      <>
        <p id="authored-note">Read the policy first</p>
        <SchemaRenderer schema={{ type: 'combobox', id: 'cb', options: OPTIONS, 'aria-describedby': 'authored-note' } as any} />
      </>,
    );
    expect(describedTexts(trigger())).toEqual(['Read the policy first']);
  });

  it('keeps the designer handles and the trigger where they were — the wrapper is for the paragraph, not a relocation', () => {
    renderNode({ id: 'cb', description: 'Where you live' });
    expect(trigger()).toHaveAttribute('data-obj-id', 'cb');
    expect(trigger()).toHaveAttribute('data-obj-type', 'combobox');
  });
});

/* ── The two premises `defaultValue`'s retirement rests on ────────────────── */

describe('the premises behind retiring `defaultValue` (objectui#8140)', () => {
  /**
   * ⚠️ A red here does NOT mean delete this case. It means a `combobox` has
   * acquired a form-FIELD path, or a selectable one, and the retirement of
   * `defaultValue` has to be re-argued before either lands.
   */
  it('PREMISE 1 — no form-field spelling reaches this renderer, so the field path never needed this key', () => {
    for (const type of ['combobox', 'field:combobox', 'ui:combobox']) {
      const { container, unmount } = render(
        <SchemaRenderer
          schema={{
            type: 'form',
            showSubmit: false,
            showCancel: false,
            fields: [{ name: 'country', type, options: OPTIONS }],
          } as any}
        />,
      );
      // CONTROL first: the form DID render a control, so the negative below is
      // not "nothing rendered".
      expect(container.querySelector('input')).toBeTruthy();
      expect(container.querySelector('[role="combobox"]')).toBeNull();
      unmount();
    }
  });

  it('PREMISE 2 — the standalone node’s selection is frozen: choosing another option changes nothing', () => {
    renderNode({ id: 'cb', value: 'cn' });
    const el = trigger();
    expect(el).toHaveTextContent('China');

    fireEvent.click(el);
    // CONTROL: the dropdown really opened and the other option really is
    // clickable, so "nothing changed" is not "nothing happened".
    const other = screen.getByRole('option', { name: /United States/ });
    expect(other).toBeInTheDocument();

    fireEvent.click(other);
    expect(trigger()).toHaveTextContent('China');
  });
});

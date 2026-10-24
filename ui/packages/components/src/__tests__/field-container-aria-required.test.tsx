/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FieldContainer — the required STATE must reach the slotted control
 * (objectui#3299, the same "declared ≠ delivered" gap #3290/#3298 closed in
 * the form renderer).
 *
 * `FieldContainer` computed `required` and spent it on exactly one thing: the
 * label's visual asterisk — paint, never a STATE. (That asterisk did reach the
 * accessible NAME: it was CSS generated content, which the name computation
 * includes, so Chromium named the control "Title*". objectui#10368 made it a
 * real `aria-hidden` element; the last case below pins that by markup, and
 * says why a happy-dom name could never have caught it.) Meanwhile its Slot
 * injection already delivered `id` / `aria-describedby` / `aria-invalid` to
 * whatever control the caller slots in, so the container was ALREADY the
 * single a11y-wiring authority for its children — it just skipped this one
 * attribute. The fix rides the same Slot injection, so one line covers every
 * consumer of FieldContainer.
 *
 * Deliberately NOT the native `required` attribute (#3290 ruling): that would
 * arm the browser's constraint-validation bubble alongside the host's own
 * `error` slot — two validators, two UIs, one field.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FieldContainer } from '../custom/field';

afterEach(cleanup);

describe('FieldContainer — `aria-required` rides the Slot injection (objectui#3299)', () => {
  it('sets aria-required="true" on the slotted control when required', () => {
    render(
      <FieldContainer label="Title" required>
        <input data-testid="ctl" />
      </FieldContainer>,
    );

    expect(screen.getByTestId('ctl')).toHaveAttribute('aria-required', 'true');
  });

  it('omits the attribute entirely when optional, rather than writing "false"', () => {
    // `|| undefined`, matching the reference shape (EmbeddableForm.tsx /
    // PR #3298): absence, not `aria-required="false"`.
    render(
      <FieldContainer label="Title">
        <input data-testid="ctl" />
      </FieldContainer>,
    );

    expect(screen.getByTestId('ctl')).not.toHaveAttribute('aria-required');
  });

  it('never sets the native `required` attribute', () => {
    // Regression fence: the "obvious" alternative fix is exactly the change
    // that must not happen (#3290 — native required arms browser constraint
    // validation on top of the host's error slot). NOT `toBeRequired()`:
    // jest-dom counts `aria-required="true"` as required, so that matcher
    // cannot distinguish the two channels.
    render(
      <FieldContainer label="Title" required>
        <input data-testid="ctl" />
      </FieldContainer>,
    );

    const ctl = screen.getByTestId('ctl') as HTMLInputElement;
    expect(ctl).toHaveAttribute('aria-required', 'true');
    expect(ctl).not.toHaveAttribute('required');
    expect(ctl.required).toBe(false);
  });

  it('coexists with the pre-existing Slot injections (id, aria-invalid, aria-describedby)', () => {
    // The fix must extend the injection, not replace it — a regression that
    // swapped the prop set instead of adding to it would pass the tests above
    // and still break error announcement.
    render(
      <FieldContainer label="Title" required error="Required" htmlFor="my-field">
        <input data-testid="ctl" />
      </FieldContainer>,
    );

    const ctl = screen.getByTestId('ctl');
    expect(ctl).toHaveAttribute('id', 'my-field');
    expect(ctl).toHaveAttribute('aria-required', 'true');
    expect(ctl).toHaveAttribute('aria-invalid', 'true');
    expect(ctl).toHaveAttribute('aria-describedby', 'my-field-error');
  });

  it('keeps the asterisk out of the name: a real aria-hidden element, never CSS generated content (objectui#10368)', () => {
    // REWRITTEN VERDICT (objectui#10368). This case used to rest on
    // `toHaveAccessibleName('Title')` under happy-dom, beside a comment saying
    // the CSS asterisk "can never leak into the accessible name". Both were
    // wrong in the same direction: the accessible-name computation INCLUDES
    // `::after` content, and Chromium named this control "Title*". The case was
    // green only because happy-dom computes no generated content, so it could
    // not go red on the very defect it claimed to exclude.
    //
    // The verdict is now the MARKUP, which fails on that defect in any DOM:
    //  1. nothing in the associated label draws generated content — a Tailwind
    //     `content-[…]` / `content-(…)` utility, bare or behind a variant;
    //  2. the visible `*` is a real element carrying `aria-hidden="true"`;
    //  3. the label's text outside `aria-hidden` subtrees is exactly the label.
    render(
      <FieldContainer label="Title" required htmlFor="assoc-field">
        <input />
      </FieldContainer>,
    );

    const label = document.querySelector('label[for="assoc-field"]') as HTMLLabelElement;
    const ctl = document.getElementById('assoc-field') as HTMLInputElement;
    expect(label).not.toBeNull();

    const generated = [label, ...Array.from(label.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => /(^|:)content-[[(]/.test(c));
    expect(generated).toEqual([]);

    const markers = label.querySelectorAll('[data-required-marker]');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('aria-hidden', 'true');
    expect(markers[0].textContent).toBe('*');

    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    expect(clone.textContent).toBe('Title');

    // The state channel is still the ONLY required signal.
    expect(ctl).toHaveAttribute('aria-required', 'true');

    // Corroboration, NOT the evidence: `dom-accessibility-api` honours
    // `aria-hidden` on a REAL element, so this line does go red if the span
    // loses its `aria-hidden`. It still cannot see generated content — it was
    // green on the defect — which is why the markup above carries the verdict.
    expect(ctl).toHaveAccessibleName('Title');
  });
});

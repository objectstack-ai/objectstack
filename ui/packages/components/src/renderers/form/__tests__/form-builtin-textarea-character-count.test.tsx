/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in (unregistered) `textarea` branch honours a declared cap the same
 * way the registered `field:textarea` widget does — objectui#3439.
 *
 * ## What was measured on `origin/main`
 *
 * One `maxLength` declaration produced two experiences. The registered path has
 * shipped four things since objectui#3406 / #3408 / #3417; this branch shipped
 * a subset of ONE, and the subset depended on how the cap was spelled:
 *
 * | | registered `field:textarea` | built-in branch (before) |
 * |---|---|---|
 * | native cap, `maxLength:` | yes | yes — by accident (see below) |
 * | native cap, `max_length:` | yes | NO — stray `max_length="…"` attribute |
 * | visible `{n}/{max}` | yes | no |
 * | cap announced on focus | yes | no |
 * | near-limit notice | yes | no |
 *
 * The camelCase cap "worked" only because `maxLength` happens to name a real
 * DOM attribute and the branch spreads its leftover field props onto the
 * element — nothing read it, so the legacy `max_length` spelling (dual-read by
 * the registered widget since framework#1878 §3, and by all three producers of
 * a form field) landed as an inert attribute and capped nothing at all.
 *
 * ⭐ objectui#11070 later retired the snake_case `max_length` everywhere:
 * `@objectstack/spec` and the strict authoring face refuse it by name, no
 * objectui type declares it, and every reader — this branch and the registered
 * widget included — reads the spec's `maxLength` alone. The pins below read it
 * that way: the retired spelling caps nothing and draws no counter.
 *
 * The consequence that matters is the accessibility one: a screen-reader user
 * on this path was told the limit only as a validation error AFTER submitting.
 * Shipping the visible digits alone would have fixed the sighted half and left
 * that exactly as broken, so the description (node 2) and the gated live region
 * (node 3) are pinned here first-class rather than as an afterthought.
 *
 * ## Why the assertions resolve IDREFs instead of finding nodes by test id
 *
 * A description node nothing references is a node no screen reader will ever
 * reach. `describedText()` follows `aria-describedby` and concatenates the
 * referenced nodes' text exactly as an assistive technology does, which is what
 * makes "the association actually works" part of the assertion rather than
 * "a node with the right text exists somewhere in the document".
 *
 * ## Why fake timers
 *
 * The near-limit debounce is 1000ms. `advanceTimersByTime(999)` proving silence
 * is a statement no real sleep can make, and ten real pauses would be a race
 * under load (AGENTS.md's flaky-test section).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

const DEBOUNCE_MS = 1000;

/** Render the built-in branch: no `registerAllFields()`, so nothing resolves from the registry. */
function renderForm(fields: any[], language = 'en') {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />
    </I18nProvider>,
  );
}

const longText = (extra: Record<string, unknown> = {}) => ({
  name: 'notes',
  label: 'Notes',
  type: 'textarea',
  ...extra,
});

/**
 * The INLINE control — a DOM query, deliberately not `getByRole`. Radix
 * `aria-hidden`s the whole document behind an open modal, so role queries stop
 * seeing this element the moment the fullscreen dialog opens, which is exactly
 * when the two-surfaces assertion below needs to read it. The portal renders
 * after the form, so index 0 is the inline one.
 */
const inlineTextarea = () => document.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
const visibleCounter = () => document.querySelector('[data-testid="form-textarea-character-count"]');
const liveRegions = () => document.querySelectorAll('[aria-live="polite"]');

/** Resolve an element's accessible DESCRIPTION the way an assistive technology does. */
const describedTextOf = (el: Element) => {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
};

const type = (el: HTMLTextAreaElement, value: string) =>
  fireEvent.change(el, { target: { value } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('built-in textarea — native cap (objectui#3439)', () => {
  it('applies a camelCase maxLength as the native attribute', () => {
    renderForm([longText({ maxLength: 100 })]);
    expect(inlineTextarea()).toHaveAttribute('maxlength', '100');
  });

  it('the retired max_length caps nothing and draws no counter (objectui#11070)', () => {
    renderForm([longText({ max_length: 100 })]);
    // The spec's `maxLength` is the one spelling read, here as in the
    // registered widget.
    expect(inlineTextarea()).not.toHaveAttribute('maxlength');
    expect(visibleCounter()).toBeNull();
  });

  it('leaves an uncapped field exactly as it was — no attribute, no counter', () => {
    renderForm([longText()]);
    expect(inlineTextarea()).not.toHaveAttribute('maxlength');
    expect(visibleCounter()).toBeNull();
    // No cap means nothing to announce, so no live region is mounted at all —
    // an unconditional one in every long-text field is the objectui#3408 defect.
    expect(liveRegions()).toHaveLength(0);
  });
});

describe('built-in textarea — the visible digits (node 1)', () => {
  it('renders {n}/{max} and keeps it decorative', () => {
    renderForm([longText({ maxLength: 100 })]);
    expect(visibleCounter()).toHaveTextContent('0/100');
    // `aria-hidden` so a screen reader does not read "0 slash 100" on top of
    // the description that says it properly.
    expect(visibleCounter()).toHaveAttribute('aria-hidden', 'true');
  });

  it('counts what the user typed', () => {
    renderForm([longText({ maxLength: 100 })]);
    type(inlineTextarea(), 'hello');
    expect(visibleCounter()).toHaveTextContent('5/100');
  });

});

describe('built-in textarea — the cap is announced ON FOCUS (node 2)', () => {
  it('reaches the control through aria-describedby, not merely by existing', () => {
    renderForm([longText({ maxLength: 100 })]);
    expect(describedTextOf(inlineTextarea())).toContain('Character count: 0 of 100');
  });

  it('updates the described sentence as the value changes', () => {
    renderForm([longText({ maxLength: 100 })]);
    type(inlineTextarea(), 'hello');
    expect(describedTextOf(inlineTextarea())).toContain('Character count: 5 of 100');
  });

  it('APPENDS to the description the form already supplied, never replaces it', () => {
    // `<FormControl>` is a Radix Slot and hands the control an
    // `aria-describedby` naming the field's own description and error message.
    // Assigning here would trade "no cap announced" for "no description
    // announced" — strictly worse, and silent.
    renderForm([longText({ maxLength: 100, description: 'Internal notes only.' })]);
    const described = describedTextOf(inlineTextarea());
    expect(described).toContain('Internal notes only.');
    expect(described).toContain('Character count: 0 of 100');
  });
});

describe('built-in textarea — the near-limit notice (node 3)', () => {
  it('mounts exactly one polite live region, and it starts empty', () => {
    renderForm([longText({ maxLength: 100 })]);
    // In the DOM before its content changes, or the first change is not
    // announced at all.
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0].textContent).toBe('');
  });

  it('stays silent through the comfortable middle of the field', () => {
    vi.useFakeTimers();
    renderForm([longText({ maxLength: 100 })]);
    // Threshold is max(ceil(100 * 0.1), 20) = 20 remaining. 30 characters
    // leaves 70 — a count nobody is close to is not news.
    type(inlineTextarea(), 'x'.repeat(30));
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS * 3));
    expect(liveRegions()[0].textContent).toBe('');
  });

  it('says what is LEFT once inside the band, and only after a pause', () => {
    vi.useFakeTimers();
    renderForm([longText({ maxLength: 100 })]);
    type(inlineTextarea(), 'x'.repeat(95));

    // Still typing: 999ms of pause is not a pause.
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS - 1));
    expect(liveRegions()[0].textContent).toBe('');

    act(() => void vi.advanceTimersByTime(1));
    expect(liveRegions()[0].textContent).toBe('Characters remaining: 5');
  });

  it('never interrupts a typist who does not pause', () => {
    vi.useFakeTimers();
    renderForm([longText({ maxLength: 100 })]);
    const el = inlineTextarea();
    for (let n = 90; n <= 99; n++) {
      type(el, 'x'.repeat(n));
      act(() => void vi.advanceTimersByTime(DEBOUNCE_MS - 1));
    }
    // Ten keystrokes deep inside the warning band, zero announcements — each
    // one cancelled the previous pending sentence.
    expect(liveRegions()[0].textContent).toBe('');
  });
});

describe('built-in textarea — the fullscreen surface (objectui#3439)', () => {
  const open = () => fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));

  it('caps and counts the dialog editor too', () => {
    renderForm([longText({ maxLength: 100, mobile_fullscreen: true })]);
    open();
    const dialog = screen.getByTestId('form-textarea-fullscreen-dialog');
    const editor = screen.getByTestId('form-textarea-fullscreen-input') as HTMLTextAreaElement;

    expect(editor).toHaveAttribute('maxlength', '100');
    expect(
      within(dialog).getByTestId('form-textarea-fullscreen-character-count'),
    ).toHaveTextContent('0/100');
  });

  it('announces the cap on the dialog control, against its OWN draft', () => {
    renderForm([longText({ maxLength: 100, mobile_fullscreen: true })]);
    open();
    const editor = screen.getByTestId('form-textarea-fullscreen-input') as HTMLTextAreaElement;
    type(editor, 'hello');

    // The dialog edits a LOCAL draft, so the two surfaces count different
    // strings — hence two description ids. One shared id would point both
    // controls at whichever sentence rendered last.
    expect(describedTextOf(editor)).toContain('Character count: 5 of 100');
    expect(describedTextOf(inlineTextarea())).toContain('Character count: 0 of 100');
  });

  it('adds NO second live region inside the modal', () => {
    renderForm([longText({ maxLength: 100, mobile_fullscreen: true })]);
    open();
    const dialog = screen.getByTestId('form-textarea-fullscreen-dialog');
    // `announceNearLimit={false}` — the ruling of objectui#3417 applied to this
    // surface: a modal opened deliberately to write at length already delivers
    // the cap on focus, and the inline region stays mounted behind the overlay,
    // so a second one would put two in one document.
    expect(dialog.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
  });

  it('gives the fullscreen inline control the counter as well', () => {
    renderForm([longText({ maxLength: 100, mobile_fullscreen: true })]);
    expect(visibleCounter()).toHaveTextContent('0/100');
    expect(describedTextOf(inlineTextarea())).toContain('Character count: 0 of 100');
  });
});

describe('built-in textarea — the counter copy travels (objectui#3439 hoist)', () => {
  it('speaks the session language, not English', () => {
    renderForm([longText({ maxLength: 100 })], 'zh');
    const described = describedTextOf(inlineTextarea());
    // The SAME `fields.textarea.*` keys the registered path consumes — the
    // hoist moved the defaults with the component, so the ten packs need no
    // new entries and the two paths cannot drift into two wordings.
    expect(described).not.toContain('Character count');
    expect(described).not.toContain('fields.textarea');
    expect(described.length).toBeGreaterThan(0);
  });

  // The provider-LESS leg lives in
  // `form-builtin-textarea-character-count.no-provider.test.tsx`: i18next is a
  // module singleton, so a provider mounted anywhere in THIS file leaves the
  // language set for every later case in it — measured, the case below read
  // `zh` after the case above. Only file-level isolation makes "no provider"
  // mean it. Same split, same reason, as the fields side's
  // `TextAreaField.characterCount.no-provider.test.tsx`.
});

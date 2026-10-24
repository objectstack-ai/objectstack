/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * HOW OFTEN the textarea character counter speaks, and what a screen reader can
 * find out without typing at all — objectui#3408.
 *
 * objectui#3406 keyed the counter's sentence and deliberately changed no
 * behaviour. This file is the behaviour half.
 *
 * ## The measurement this replaces
 *
 * Probe run against `origin/main` (zh session, `maxLength: 500`, the sentence
 * "Follow up with the customer about the renewal quote." typed one character at
 * a time — reproduced verbatim by `speaks nothing across the issue's 52
 * keystroke probe` below):
 *
 * ```json
 * { "keystrokes": 52, "announcementsFired": 52, "distinctAnnouncements": 52,
 *   "totalCharsSpoken": 979, "regionIsAriaHidden": null,
 *   "textareaDescribedBy": null }
 * ```
 *
 * 979 spoken characters for 52 typed ones — ~19x — every one of them cutting
 * off the screen reader's echo of the letter the user had just pressed. The
 * counter element was simultaneously the visible digits, the translated
 * sentence and the live region, so "re-render" and "announce" were the same
 * event.
 *
 * ## The shape being pinned (GOV.UK character-count, three nodes)
 *
 * 1. the visible `{n}/{max}` digits, `aria-hidden` — decorative;
 * 2. a visually-hidden DESCRIPTION carrying the full sentence, reached through
 *    the textarea's `aria-describedby` — read once on focus;
 * 3. a visually-hidden `aria-live="polite"` STATUS region, silent until the
 *    value is inside the last 10% / 20 characters of the cap, and updated only
 *    after the typist pauses.
 *
 * ## Why fake timers
 *
 * The debounce is 1000ms. Ten real pauses would add ten seconds of wall clock
 * to every CI run and would still be a race under load (AGENTS.md's flaky-test
 * section). `vi.useFakeTimers()` makes the pause an assertion instead of a
 * wait: `advanceTimersByTime(999)` proving silence is a statement no sleep can
 * make.
 *
 * ## Counting rule used throughout
 *
 * A screen reader speaks when a live region's content CHANGES to something
 * non-empty. Emptying it says nothing. `announcementsOf()` below counts exactly
 * that, so the numbers here are comparable to the probe's.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { TextAreaField } from '../TextAreaField';
import type { FieldWidgetComponentProps } from '../types';
import type { FieldMetadata } from '@object-ui/types';

const DEBOUNCE_MS = 1000;

const textareaField = (extra: Record<string, unknown> = {}) =>
  ({ name: 'notes', type: 'textarea', ...extra }) as unknown as FieldMetadata;

/** The `aria-live` node — now the ONLY one in this widget, by construction. */
const statusRegion = () => document.querySelector('[aria-live="polite"]');
const statusText = () => statusRegion()?.textContent ?? null;
const visibleCounter = () => document.querySelector('[data-testid="textarea-character-count"]');
const textarea = () => screen.getByRole('textbox');

/**
 * Resolve the textarea's accessible DESCRIPTION the way an assistive technology
 * does — follow `aria-describedby`, in order, and concatenate the referenced
 * nodes' text. Asserting on this rather than on a node found by test id is what
 * makes "the association actually works" part of the assertion.
 */
const describedText = () => {
  const ids = (textarea().getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
};

/** A host that owns the value, so `fireEvent.change` really is a keystroke. */
// `maxLength` has NO default on purpose: a default would swallow the
// no-cap cases, which pass it as `undefined`.
function Host({
  initial = '',
  maxLength,
  ...rest
}: { initial?: string; maxLength?: number } & Partial<FieldWidgetComponentProps<string>>) {
  const [v, setV] = React.useState(initial);
  return (
    <TextAreaField value={v} onChange={setV} field={textareaField({ maxLength })} {...rest} />
  );
}

const renderIn = (language: string, element: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );

const pause = (ms = DEBOUNCE_MS) => act(() => { vi.advanceTimersByTime(ms); });

/**
 * Type `text` one character at a time onto `prefix`, sampling the status region
 * after every keystroke, and return every distinct non-empty sentence it was
 * changed to. `pauseEvery` = how many keystrokes between 1s pauses (0 = the
 * issue's probe: continuous typing, never pausing).
 */
function announcementsOf(prefix: string, text: string, pauseEvery = 0): string[] {
  const spoken: string[] = [];
  let last = statusText();
  const record = () => {
    const now = statusText();
    if (now !== last) {
      if (now) spoken.push(now);
      last = now;
    }
  };
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(textarea(), { target: { value: prefix + text.slice(0, i) } });
    record();
    if (pauseEvery && i % pauseEvery === 0) {
      pause();
      record();
    }
  }
  return spoken;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the counter no longer narrates every keystroke (objectui#3408)', () => {
  const SENTENCE = 'Follow up with the customer about the renewal quote.';

  it('speaks nothing across the issue`s 52-keystroke probe', () => {
    // The probe, verbatim: zh, maxLength 500, 52 characters typed one at a
    // time. Measured before this change: 52 announcements / 979 characters.
    expect(SENTENCE).toHaveLength(52);
    renderIn('zh', <Host maxLength={500} />);

    const spoken = announcementsOf('', SENTENCE);

    expect(spoken).toEqual([]);
    expect(spoken.reduce((n, s) => n + s.length, 0)).toBe(0);
    // The value really was typed — otherwise the silence above proves nothing.
    expect(visibleCounter()).toHaveTextContent('52/500');
  });

  it('stays silent even if the typist pauses a full second after EVERY keystroke', () => {
    // The pessimistic variant, and the one that separates the two mechanisms:
    // with a flush after every character the debounce can suppress nothing, so
    // anything still silent here is silent because of the THRESHOLD. 52 of 500
    // used leaves 448 remaining, nowhere near the last 50.
    renderIn('zh', <Host maxLength={500} />);

    expect(announcementsOf('', SENTENCE, 1)).toEqual([]);
  });

  it('speaks a single-digit number of times over a run that ends AT the cap', () => {
    // The realistic worst case: the same 52 keystrokes, but landing exactly on
    // a 500-character cap, with a pause every 10 characters. Every pause from
    // here on is inside the warning band, so this is the run that produces the
    // most speech the design allows — and it is still 5, against the 52 the
    // probe measured for a run that never came near the limit at all.
    renderIn('zh', <Host maxLength={500} initial={'x'.repeat(448)} />);

    const spoken = announcementsOf('x'.repeat(448), SENTENCE, 10);

    expect(spoken.length).toBeLessThan(10);
    expect(spoken).toEqual([
      '还可输入 42 个字符',
      '还可输入 32 个字符',
      '还可输入 22 个字符',
      '还可输入 12 个字符',
      '还可输入 2 个字符',
    ]);
  });
});

describe('the status region is debounced (objectui#3408)', () => {
  it('says nothing until the typing stops', () => {
    // maxLength 100 → the warning band is the last 20 characters, so every
    // keystroke below is inside it and only the PAUSE is holding speech back.
    renderIn('en', <Host maxLength={100} initial={'x'.repeat(80)} />);
    expect(statusText()).toBe('');

    announcementsOf('x'.repeat(80), 'abcde');

    // Five keystrokes inside the warning band, still nothing spoken.
    expect(statusText()).toBe('');
    pause(DEBOUNCE_MS - 1);
    // 999ms of quiet is not a pause. Asserting the near-miss is the difference
    // between pinning a debounce and pinning "it eventually says something".
    expect(statusText()).toBe('');

    pause(1);
    expect(statusText()).toBe('Characters remaining: 15');
  });

  it('collapses a burst into ONE announcement, not one per keystroke', () => {
    renderIn('en', <Host maxLength={100} initial={'x'.repeat(80)} />);

    const spoken = announcementsOf('x'.repeat(80), 'abcdefghij');
    pause();

    expect(spoken).toEqual([]);
    expect(statusText()).toBe('Characters remaining: 10');
  });

  it('does not re-announce a count the user typed their way back to', () => {
    // Type one character, pause, delete it, pause. The sentence is identical
    // both times, so the DOM does not change and nothing is spoken twice.
    renderIn('en', <Host maxLength={100} initial={'x'.repeat(85)} />);
    pause();
    expect(statusText()).toBe('Characters remaining: 15');

    fireEvent.change(textarea(), { target: { value: 'x'.repeat(86) } });
    pause();
    expect(statusText()).toBe('Characters remaining: 14');

    fireEvent.change(textarea(), { target: { value: 'x'.repeat(85) } });
    pause();
    expect(statusText()).toBe('Characters remaining: 15');
  });
});

describe('the status region is threshold-gated (objectui#3408)', () => {
  it('is silent one character OUTSIDE the band and speaks one character inside it', () => {
    // 500-character cap → 10% is 50, which the typist reaches before the flat
    // 20, so 50 is the boundary. Both directions asserted: a gate that never
    // opens and a gate that is always open both pass a one-sided check.
    const { unmount } = renderIn('en', <Host maxLength={500} initial={'x'.repeat(449)} />);
    pause();
    expect(statusText()).toBe('');
    unmount();

    renderIn('en', <Host maxLength={500} initial={'x'.repeat(450)} />);
    pause();
    expect(statusText()).toBe('Characters remaining: 50');
  });

  it('falls back to the flat 20 characters when 10% of the cap is smaller', () => {
    // 100-character cap: 10% is 10, but 20 remaining arrives FIRST, so 20 is
    // the boundary. This is the case that pins `max()` — take `min()` and the
    // warning arrives ten characters too late, which no assertion on the 500
    // case above can see.
    const { unmount } = renderIn('en', <Host maxLength={100} initial={'x'.repeat(79)} />);
    pause();
    expect(statusText()).toBe('');
    unmount();

    renderIn('en', <Host maxLength={100} initial={'x'.repeat(80)} />);
    pause();
    expect(statusText()).toBe('Characters remaining: 20');
  });

  it('goes quiet again — immediately — when the user deletes back out of the band', () => {
    renderIn('en', <Host maxLength={500} initial={'x'.repeat(460)} />);
    pause();
    expect(statusText()).toBe('Characters remaining: 40');

    fireEvent.change(textarea(), { target: { value: 'x'.repeat(400) } });

    // No pause needed: emptying a live region announces nothing, so silence is
    // free and should not wait a second to take effect.
    expect(statusText()).toBe('');
  });

  it('never re-announces the STALE count when the user types back into the band', () => {
    // The excursion case. Reach the band, be announced, delete far out of it,
    // then type back in at a different length. The naive "show the last settled
    // sentence whenever we are in the band" renders the count from BEFORE the
    // excursion for a full second before the timer corrects it — a wrong
    // number, spoken, which is worse than the silence it replaces.
    renderIn('en', <Host maxLength={500} initial={'x'.repeat(460)} />);
    pause();
    expect(statusText()).toBe('Characters remaining: 40');

    fireEvent.change(textarea(), { target: { value: 'x'.repeat(300) } });
    expect(statusText()).toBe('');

    fireEvent.change(textarea(), { target: { value: 'x'.repeat(455) } });
    // The moment of the bug: 45 is the truth, 40 is what was cached.
    expect(statusText()).toBe('');
    pause();
    expect(statusText()).toBe('Characters remaining: 45');
  });

  it('clamps an over-long value to zero remaining rather than counting backwards', () => {
    // Reachable when a cap is lowered after the record was saved. "-3 remaining"
    // is not a sentence, and the textarea's own maxLength blocks further input,
    // so 0 is the true actionable number. The full, honest count stays in the
    // description.
    renderIn('en', <Host maxLength={500} initial={'x'.repeat(503)} />);
    pause();

    expect(statusText()).toBe('Characters remaining: 0');
    expect(describedText()).toBe('Character count: 503 of 500');
  });

  it('treats a very small cap as near-limit from the first keystroke', () => {
    // 10-character cap: the flat 20 exceeds the whole field, so every state is
    // "nearly full". That is correct, and the debounce still bounds it to one
    // announcement per pause.
    renderIn('en', <Host maxLength={10} initial="ab" />);
    pause();

    expect(statusText()).toBe('Characters remaining: 8');
  });
});

describe('the counter is reachable without typing (objectui#3408)', () => {
  it('describes the textarea, so focus announces the cap once', () => {
    // Measured before this change: `textareaDescribedBy: null` — a screen
    // reader user learned there was a limit only by bumping into it.
    renderIn('en', <Host maxLength={500} initial="hello" />);

    expect(textarea()).toHaveAttribute('aria-describedby');
    expect(describedText()).toBe('Character count: 5 of 500');
  });

  it('APPENDS to the host`s aria-describedby instead of replacing it', () => {
    // `<FormControl>` is a Radix Slot: it hands the control an
    // `aria-describedby` naming the field description and error message, and
    // it arrives here through `toDomProps`. Clobbering it would trade "no cap
    // announced" for "no ERROR announced".
    render(
      <>
        <span id="host-desc">Internal notes only</span>
        <Host maxLength={500} initial="hello" aria-describedby="host-desc" />
      </>,
    );

    const ids = textarea().getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('host-desc');
    expect(ids).toHaveLength(2);
    expect(describedText()).toBe('Internal notes only Character count: 5 of 500');
  });

  it('keeps the visible digits out of the accessibility tree', () => {
    // Measured before: `regionIsAriaHidden: null`. The digits are a glance
    // affordance; unhidden they make a screen reader read "5 slash 500" on top
    // of the description that says it in words.
    renderIn('en', <Host maxLength={500} initial="hello" />);

    expect(visibleCounter()).toHaveAttribute('aria-hidden', 'true');
    expect(visibleCounter()).toHaveTextContent('5/500');
    expect(visibleCounter()).not.toHaveAttribute('aria-live');
  });

  it('renders the live region EMPTY at mount rather than conditionally', () => {
    // A live region inserted at the same moment as its text is not reliably
    // announced — it has to be in the DOM first. `{status && <span …>}` would
    // pass every "is it silent?" assertion above and break the one case the
    // whole gate exists to serve.
    renderIn('en', <Host maxLength={500} />);

    expect(statusRegion()).not.toBeNull();
    expect(statusText()).toBe('');
  });

  it('adds neither node when the field declares no cap', () => {
    render(<Host maxLength={undefined} />);

    expect(statusRegion()).toBeNull();
    expect(visibleCounter()).toBeNull();
    expect(textarea()).not.toHaveAttribute('aria-describedby');
  });

  it('leaves a host describedby alone when there is no cap to describe', () => {
    render(
      <>
        <span id="host-desc">Internal notes only</span>
        <Host maxLength={undefined} aria-describedby="host-desc" />
      </>,
    );

    expect(textarea()).toHaveAttribute('aria-describedby', 'host-desc');
  });

  it('gives two textareas on one form distinct description ids', () => {
    // The ids come from `useId()`, per instance. Shared ids would point both
    // fields at whichever description rendered last.
    render(
      <>
        <Host maxLength={500} initial="a" />
        <Host maxLength={300} initial="bb" />
      </>,
    );

    const [first, second] = screen.getAllByRole('textbox');
    const idOf = (el: HTMLElement) => el.getAttribute('aria-describedby');
    expect(idOf(first)).not.toBe(idOf(second));
    expect(document.getElementById(idOf(first)!)!.textContent).toBe('Character count: 1 of 500');
    expect(document.getElementById(idOf(second)!)!.textContent).toBe('Character count: 2 of 300');
  });

  it('renders no counter, no status region and no description when readonly', () => {
    renderIn('en', <TextAreaField value="hello" onChange={vi.fn()} readonly field={textareaField({ maxLength: 500 })} />);

    expect(statusRegion()).toBeNull();
    expect(visibleCounter()).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});

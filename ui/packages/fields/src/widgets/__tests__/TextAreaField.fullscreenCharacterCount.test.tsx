/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What a screen reader can find out about the character cap INSIDE the
 * fullscreen long-text dialog — objectui#3417.
 *
 * ## The state this replaces
 *
 * objectui#3408 gave the inline counter three nodes. The fullscreen dialog's
 * counter, handed to `FullscreenFieldEditor` as a `footer`, stayed what it had
 * been since the feature shipped:
 *
 * ```jsx
 * footer={(draft) => maxLength
 *   ? <span className="…">{draft.length}/{maxLength}</span>
 *   : null}
 * ```
 *
 * Digits, and nothing else. No accessible name, no `aria-describedby` tying it
 * to the dialog's `textarea`, nothing `aria-live`. Browse mode read "5 slash
 * 500" if it happened to sweep the footer; focusing the input said nothing at
 * all. Same field, same cap, same user as the inline surface — and the
 * fullscreen branch was at zero.
 *
 * Reachability is not exotic: `ObjectForm` stamps `mobile_fullscreen` onto
 * EVERY long-text field when `ObjectFormSchema.mobile.fullscreenLongText` is
 * set, so on a phone with that setting on, every capped long-text field in the
 * form is this case.
 *
 * ## What is pinned here, and what is deliberately NOT
 *
 * The dialog gets two of the three nodes — `aria-hidden` digits and a
 * visually-hidden DESCRIPTION reached through the textarea's
 * `aria-describedby`. It gets NO live region, and that absence is asserted
 * rather than left to chance (`no aria-live node inside the dialog`): a modal
 * the user opened deliberately to write at length should not also interrupt
 * them, the description already delivers the cap on focus, and the inline
 * surface's live region stays mounted behind the overlay — a second one would
 * put two in one document.
 *
 * That assertion is therefore GREEN on `origin/main` too, and is expected to
 * be. It is not evidence of the fix; it is the pin that the fix did not
 * overreach. The cases that change direction are the describedby/description
 * ones, which are red on `origin/main` for the plainest possible reason —
 * `aria-describedby` is absent and there is no description node to point at.
 *
 * ## Why this file mounts no `I18nProvider`
 *
 * Two reasons, and they are the same reason. Mounting `I18nProvider` calls
 * `initReactI18next`, which installs that instance as react-i18next's GLOBAL
 * default — after any sibling case has done so there is no "no provider" state
 * left in this module graph to observe, which is why
 * `TextAreaField.characterCount.no-provider.test.tsx` and
 * `FullscreenFieldEditor.no-provider.test.tsx` are separate FILES rather than
 * separate `describe`s. Keeping this file provider-less makes its English
 * expectations a genuine assertion about the code-shipped `FIELD_DEFAULTS`
 * fallback on the fullscreen path — a raw key surfacing in a
 * screen-reader-only string is invisible to everyone who could report it. The
 * locale leg lives in `TextAreaField.fullscreenCharacterCount.i18n.test.tsx`.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextAreaField } from '../TextAreaField';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'description',
    label: 'Description',
    type: 'textarea',
    mobile_fullscreen: true,
    ...extra,
  }) as unknown as FieldMetadata;

const dialog = () => screen.getByTestId('textarea-fullscreen-dialog');
const fullscreenInput = () =>
  screen.getByTestId('textarea-fullscreen-input') as HTMLTextAreaElement;
const fullscreenCounter = () =>
  document.querySelector('[data-testid="textarea-fullscreen-character-count"]');
const inlineCounter = () => document.querySelector('[data-testid="textarea-character-count"]');

/**
 * Resolve an element's accessible DESCRIPTION the way an assistive technology
 * does — follow `aria-describedby`, in order, and concatenate the referenced
 * nodes' text. Asserting on this rather than on a node found by test id is
 * what puts "the association actually works" under assertion: a description
 * node nothing references is a node no screen reader will ever reach, and that
 * is precisely the failure a footer-shaped counter invites.
 */
const describedText = (el: HTMLElement) => {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
};

/** A host that owns the value, so a committed edit really changes it. */
function Host({
  initial = '',
  maxLength,
  metaExtra = {},
}: {
  initial?: string;
  maxLength?: number;
  metaExtra?: Record<string, unknown>;
}) {
  const [v, setV] = React.useState(initial);
  return (
    <TextAreaField value={v} onChange={setV} field={fieldMeta({ maxLength, ...metaExtra })} />
  );
}

const openDialog = () => fireEvent.click(screen.getByTestId('textarea-fullscreen-toggle'));

describe('the fullscreen dialog counter is reachable from the input (objectui#3417)', () => {
  it('describes the dialog textarea, so focus announces the cap once', () => {
    // Measured on `origin/main`: the dialog's textarea carried no
    // `aria-describedby` at all, so this is the assertion that flips.
    render(<Host maxLength={500} initial="hello" />);
    openDialog();

    expect(fullscreenInput()).toHaveAttribute('aria-describedby');
    expect(describedText(fullscreenInput())).toBe('Character count: 5 of 500');
  });

  it('keeps the visible digits out of the accessibility tree', () => {
    // The digits are a glance affordance. Unhidden they make a screen reader
    // read "5 slash 500" on top of the description that says it in words —
    // which is exactly what browse mode did on the old bare-span footer.
    render(<Host maxLength={500} initial="hello" />);
    openDialog();

    expect(fullscreenCounter()).toHaveAttribute('aria-hidden', 'true');
    expect(fullscreenCounter()).toHaveTextContent('5/500');
    expect(fullscreenCounter()).not.toHaveAttribute('aria-live');
  });

  it('counts the DRAFT, in the digits and in the description together', () => {
    // The dialog edits a local draft that is not written back until "Done"
    // (`FullscreenFieldEditor`). A description sourced from the committed
    // value instead would describe the field the user is no longer looking at,
    // and would silently disagree with the digits beside it — so both are
    // asserted from the same edit.
    render(<Host maxLength={500} initial="hello" />);
    openDialog();

    fireEvent.change(fullscreenInput(), { target: { value: 'hello from fullscreen' } });

    expect(fullscreenCounter()).toHaveTextContent('21/500');
    expect(describedText(fullscreenInput())).toBe('Character count: 21 of 500');
  });

  it('substitutes both placeholders from the code-shipped fallback', () => {
    // No provider is mounted, so whatever renders here came from
    // `FIELD_DEFAULTS` via `createSafeTranslation`. The failure this guards is
    // a raw key or an unsubstituted `{{max}}` reaching a screen-reader-only
    // string, where nobody who can see it is affected and nobody affected can
    // see it.
    render(<Host maxLength={40} initial="hi" />);
    openDialog();

    expect(describedText(fullscreenInput())).toBe('Character count: 2 of 40');
    expect(describedText(fullscreenInput())).not.toMatch(/fields\.textarea/);
    expect(describedText(fullscreenInput())).not.toContain('{{');
  });

  it('announces zero for an empty draft rather than a hole in the sentence', () => {
    // `0` is falsy — the one input length at which a truthiness-guarded
    // interpolation drops the number and speaks "Character count:  of 40".
    render(<Host maxLength={40} />);
    openDialog();

    expect(describedText(fullscreenInput())).toBe('Character count: 0 of 40');
  });

  it('the code-shipped default carries no CJK (Commandment #-1)', () => {
    // Escaped ranges on purpose: a literal CJK character class would itself
    // violate the commandment this asserts (same shape as
    // `FullscreenFieldEditor.no-provider.test.tsx`).
    render(<Host maxLength={200} initial="hello" />);
    openDialog();

    // The positive assertion FIRST, and not decoration: a negative match on a
    // sentence that does not exist is satisfied by the empty string, so
    // without this line the case is green on `origin/main` for the one reason
    // that proves nothing.
    expect(describedText(fullscreenInput())).toBe('Character count: 5 of 200');
    expect(describedText(fullscreenInput())).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff]/);
  });

  it('reads the spec maxLength only — the retired snake_case max_length draws no counter here either (objectui#11070)', () => {
    // The widget dual-read `maxLength ?? max_length` from framework#1878 §3
    // until objectui#11070 retired the snake_case spelling. The fullscreen
    // surface shares the inline one's single read, so it draws nothing for it.
    render(<Host metaExtra={{ max_length: 80 }} initial="hello" />);
    openDialog();

    expect(fullscreenCounter()).toBeNull();
  });
});

describe('the fullscreen dialog stays SILENT while typing (objectui#3417)', () => {
  it('renders no aria-live node inside the dialog', () => {
    // The ruling on #3417, pinned as an absence. GREEN on `origin/main` too —
    // there was nothing accessible in that footer at all — so this case is not
    // evidence of the fix, it is the guard against the fix overreaching into a
    // second live region. `[aria-live]` unqualified, because "assertive"
    // instead of "polite" would be worse, not compliant.
    render(<Host maxLength={100} initial={'x'.repeat(95)} />);
    openDialog();

    // Deep inside the warning band (5 of 100 left): if a status region existed
    // on this surface, this is the state that would fill it.
    expect(dialog().querySelector('[aria-live]')).toBeNull();
    expect(dialog().querySelector('[aria-atomic]')).toBeNull();
  });

  it('grows no live region as the draft crosses into the near-limit band', () => {
    render(<Host maxLength={100} initial="short" />);
    openDialog();

    fireEvent.change(fullscreenInput(), { target: { value: 'x'.repeat(99) } });

    expect(fullscreenCounter()).toHaveTextContent('99/100');
    expect(dialog().querySelector('[aria-live]')).toBeNull();
  });
});

describe('the two surfaces are wired independently (objectui#3417)', () => {
  it('gives the inline and fullscreen descriptions distinct ids', () => {
    // One shared id would point both textareas at whichever sentence rendered
    // last — and the two diverge the moment the user types in the dialog,
    // which is the whole reason the dialog holds a draft.
    render(<Host maxLength={500} initial="hello" />);
    const inline = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    const inlineDescribedBy = inline.getAttribute('aria-describedby');
    openDialog();
    const fullscreenDescribedBy = fullscreenInput().getAttribute('aria-describedby');

    // BOTH asserted present before they are compared. `not.toBe` alone is
    // satisfied by `null !== 'some-id'`, which is exactly the `origin/main`
    // state this case is supposed to reject — the trap of an assertion that
    // passes because nothing was produced.
    expect(inlineDescribedBy).not.toBeNull();
    expect(fullscreenDescribedBy).not.toBeNull();
    expect(fullscreenDescribedBy).not.toBe(inlineDescribedBy);
    // And each resolves to its own sentence, not to the other's node.
    expect(describedText(fullscreenInput())).toBe('Character count: 5 of 500');
  });

  it('leaves the inline description on the committed value while the draft moves', () => {
    // The draft is local until "Done". Both descriptions are live at once (the
    // inline one behind the overlay), so a shared source would make one of
    // them a lie.
    render(<Host maxLength={500} initial="hello" />);
    const inline = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    openDialog();

    fireEvent.change(fullscreenInput(), { target: { value: 'hello from fullscreen' } });

    expect(describedText(fullscreenInput())).toBe('Character count: 21 of 500');
    expect(describedText(inline)).toBe('Character count: 5 of 500');
    expect(inlineCounter()).toHaveTextContent('5/500');
  });

  it('lets the committed edit flow back to the inline counter on Done', () => {
    // End to end, because a counter that describes a draft nobody commits
    // would satisfy every assertion above.
    render(<Host maxLength={500} initial="hello" />);
    openDialog();

    fireEvent.change(fullscreenInput(), { target: { value: 'hello from fullscreen' } });
    fireEvent.click(screen.getByTestId('textarea-fullscreen-save'));

    expect(inlineCounter()).toHaveTextContent('21/500');
    const inline = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    expect(describedText(inline)).toBe('Character count: 21 of 500');
  });

  it('keeps the inline surface at three nodes, live region included', () => {
    // The extraction must not have cost the inline surface anything. Its own
    // pins live in the objectui#3408 files and are untouched; this is the
    // cross-check from the fullscreen side, taken with the dialog OPEN so that
    // "there is one live region in the document, and it is the inline one" is
    // asserted as a whole.
    render(<Host maxLength={100} initial={'x'.repeat(95)} />);
    openDialog();

    const liveRegions = document.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions).toHaveLength(1);
    expect(dialog().contains(liveRegions[0])).toBe(false);
    expect(inlineCounter()).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('a field with no cap gets no fullscreen counter (objectui#3417)', () => {
  it('renders neither digits nor a description node', () => {
    // `{maxLength && …}` on both surfaces. Sharing the component must not make
    // either one unconditional.
    render(<Host maxLength={undefined} />);
    openDialog();

    expect(fullscreenCounter()).toBeNull();
    expect(inlineCounter()).toBeNull();
  });

  it('leaves the dialog textarea`s aria-describedby unset', () => {
    // An `aria-describedby` naming an id that does not exist is worse than
    // none: some assistive technologies fall back to reading the id string.
    render(<Host maxLength={undefined} />);
    openDialog();

    expect(fullscreenInput()).not.toHaveAttribute('aria-describedby');
  });

  it('renders no counter on either surface when the field is readonly', () => {
    // The readonly branch early-returns a display before any of this is
    // computed, so there is no dialog to open at all. Pinned as a
    // non-regression of the hook hoist.
    render(
      <TextAreaField
        value="hello"
        onChange={vi.fn()}
        readonly
        field={fieldMeta({ maxLength: 500 })}
      />,
    );

    expect(inlineCounter()).toBeNull();
    expect(fullscreenCounter()).toBeNull();
    expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toBeNull();
  });
});

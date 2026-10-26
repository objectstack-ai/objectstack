/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useState } from 'react';
import { createSafeTranslation } from '@object-ui/i18n';

/**
 * The character counter a capped long-text field renders, in the GOV.UK
 * character-count shape — extracted from `TextAreaField` so that widget's TWO
 * editing surfaces (the inline textarea and the fullscreen dialog) render the
 * SAME counting UI instead of two hand-written copies (objectui#3417).
 *
 * ## Why this lives in `components` (objectui#3439)
 *
 * There were not two surfaces but FOUR. The two above are the registered
 * `field:textarea` widget's; the form renderer's built-in, unregistered
 * `textarea` branch has an inline control and a fullscreen dialog of its own,
 * and both rendered no counter at all. One `maxLength` declaration therefore
 * produced two experiences: on the registered path a visible count, a cap
 * announced on focus and a gated near-limit warning; on the built-in path
 * nothing but a validation error after submit — i.e. a screen-reader user was
 * told the cap only once they had already exceeded it.
 *
 * The hoist direction is the one PR #4193 measured and the maintainer ruled on
 * for `FullscreenEditor` (objectui#3398, 2026-08-10): `@object-ui/fields`
 * depends on `@object-ui/components` and `components` declares no dependency on
 * `fields` in either `dependencies` or `peerDependencies`, so the shared piece
 * lands HERE, where both render paths may reach it. `TextAreaField` imports it
 * from this package and is otherwise unchanged.
 *
 * This is the same bounded exception to the package's "Pure UI, no business
 * logic" charter (AGENTS.md §3) that `FullscreenEditor` is: what it owns is
 * presentation and an announcement schedule, not metadata — it reads no field
 * config, touches no data layer, and imports nothing from `fields`.
 *
 * ## Why this is shared rather than copied
 *
 * objectui#3408 gave the inline counter three nodes — decorative digits, an
 * accessible description, a gated status region. The fullscreen dialog's
 * counter, passed to `FullscreenFieldEditor` as a `footer`, stayed what it had
 * always been: a bare `{n}/{max}` `span` with no accessible name, no
 * `aria-describedby` association with the dialog's textarea, and nothing
 * `aria-live`. Same field, same cap, same user — and a screen reader in the
 * fullscreen dialog got nothing at all, while browse mode read "5 slash 500".
 *
 * That is the failure mode this package keeps paying for (objectui#3301: the
 * fullscreen flag reached `RichTextField` for as long as the feature existed
 * and that widget never read it). A second hand-written copy of a counting UI
 * is the same failure with an extra step: it drifts, and nothing reports the
 * drift. So the counter has ONE implementation and each surface renders it.
 *
 * ## The three nodes, and why the third is a prop
 *
 * 1. the visible `{n}/{max}` digits, `aria-hidden` — a glance affordance;
 * 2. a visually-hidden DESCRIPTION carrying the translated sentence. The host
 *    owns {@link CharacterCountProps.descriptionId} and MUST name it in the
 *    edited control's `aria-describedby`, which is what makes the sentence
 *    reachable on focus rather than only in browse mode;
 * 3. a visually-hidden `aria-live="polite"` STATUS region, silent until the
 *    value is inside the last 10% / 20 characters of the cap and updated only
 *    after the typist pauses.
 *
 * Node 3 is opt-in per surface ({@link CharacterCountProps.announceNearLimit}),
 * required rather than defaulted, because "should this surface interrupt the
 * user while they type?" is a real decision and neither answer should be
 * reached by leaving a prop off. The fullscreen dialog answers no: it is a
 * modal the user opened deliberately to write at length, the description
 * already tells them the cap on focus, and the dialog's own textarea carries
 * the same native `maxLength` stop as the inline one. The inline surface
 * answers yes, unchanged from objectui#3408.
 */

/**
 * How long the typist must pause before the counter's status region is allowed
 * to change (objectui#3408). The GOV.UK Design System character-count component
 * uses the same shape and the same order of magnitude.
 *
 * The number this replaces was effectively 0: the counter WAS the live region,
 * so every keystroke re-rendered it and every re-render was an announcement.
 * Measured on `origin/main`, zh session, `maxLength: 500`, typing a 52-character
 * sentence one character at a time: 52 keystrokes produced 52 distinct
 * announcements totalling 979 spoken characters — ~19x the text the user was
 * trying to write, each one interrupting the screen reader's echo of what they
 * had just typed.
 */
const COUNTER_STATUS_DEBOUNCE_MS = 1000;

/** Announce inside the last 10% of the cap … */
const COUNTER_STATUS_REMAINING_RATIO = 0.1;
/** … or the last 20 characters — whichever the typist reaches FIRST. */
const COUNTER_STATUS_MIN_REMAINING = 20;

/**
 * The remaining-character count at or below which the status region speaks.
 *
 * "10% remaining OR 20 characters remaining, whichever comes first" is a
 * disjunction, and because `remaining` only ever counts DOWN as the user types,
 * the branch that fires first is simply the LARGER of the two — hence `max`.
 * A 500-character cap starts warning at 50 remaining; a 100-character cap at 20
 * (10% of it would be 10, which the typist would reach later, not sooner).
 *
 * A cap smaller than {@link COUNTER_STATUS_MIN_REMAINING} is therefore "near
 * the limit" from the first keystroke, which is correct: on a 10-character
 * field every character genuinely is one of the last few. The debounce still
 * bounds it to one announcement per pause.
 */
function counterStatusThreshold(maxLength: number): number {
  return Math.max(
    Math.ceil(maxLength * COUNTER_STATUS_REMAINING_RATIO),
    COUNTER_STATUS_MIN_REMAINING,
  );
}

/**
 * The counter's copy, on the SAME `fields.textarea.*` keys the fields-side
 * implementation consumed (objectui#3406 / #3408), so the ten locale packs need
 * no new entries and the two render paths cannot drift into two wordings. The
 * defaults below are byte-identical to the ones that lived in
 * `useFieldTranslation`'s `FIELD_DEFAULTS`, which is why a provider-less embed
 * renders exactly what it did before the hoist.
 *
 * `createSafeTranslation`, not a bare `useObjectTranslation`: this counter is
 * rendered without an `I18nProvider` by standalone/embedded hosts — precisely
 * the hosts the built-in branch exists for — and by many bare-render tests.
 * Same mechanism, same reason, as `FullscreenEditor` next door.
 */
const useSafeCounterTranslation = createSafeTranslation(
  {
    'fields.textarea.characterCount': 'Character count: {{count}} of {{max}}',
    'fields.textarea.charactersRemaining': 'Characters remaining: {{count}}',
  },
  // Probe key: one this component itself consumes, so it cannot rot into
  // pointing at a key no caller reads.
  'fields.textarea.characterCount',
);

export interface CharacterCountProps {
  /**
   * Length of the text this surface is counting. The inline surface passes the
   * committed value's length; the fullscreen dialog passes the DRAFT's, which
   * is the number that is true of what the user is looking at.
   */
  length: number;
  /**
   * The declared cap. Callers render this component only when the field
   * declares one, so it is non-optional here — a counter with no cap to count
   * against has nothing to say and must not be mounted at all (an unconditional
   * live region in every long-text field is the objectui#3408 defect back
   * again).
   */
  maxLength: number;
  /**
   * The description node's `id`, minted by the host from `useId()`.
   *
   * The host MUST also name it in the edited control's `aria-describedby` —
   * this component renders the sentence, only the host knows which element is
   * being described, and a description nothing references is a node no screen
   * reader will ever reach. That association is asserted from the OUTSIDE (the
   * tests resolve `aria-describedby` and concatenate the referenced nodes' text,
   * exactly as an assistive technology does) rather than trusted here.
   *
   * Two surfaces of one widget therefore need two ids: the dialog's draft and
   * the inline value diverge the moment the user types in the dialog, so one
   * shared id would point both controls at whichever sentence rendered last.
   */
  descriptionId: string;
  /**
   * Render node 3, the threshold-gated debounced `aria-live` status region.
   *
   * Required on purpose — see the component doc above. `false` removes the
   * region from the DOM entirely (not merely empties it), which is the only
   * form of "no live region" a test can tell apart from "a live region that
   * happens to be silent right now".
   */
  announceNearLimit: boolean;
  /**
   * Classes for the visible digits. Required because placement is entirely the
   * surface's business — inline pins them to the textarea's bottom-right
   * corner, the dialog lays them out as a footer item — and a default borrowed
   * from either one would position the other wrongly while looking deliberate.
   */
  className: string;
  /**
   * `data-testid` for the visible digits, namespaced per surface
   * (`textarea-character-count`, `textarea-fullscreen-character-count`) so a
   * test that finds digits can say WHICH surface it found them on. Same
   * convention, same reason, as `FullscreenFieldEditor`'s `testIdPrefix`.
   */
  testId: string;
}

export function CharacterCount({
  length,
  maxLength,
  descriptionId,
  announceNearLimit,
  className,
  testId,
}: CharacterCountProps) {
  const { t } = useSafeCounterTranslation();

  /**
   * The counter sentence as a DESCRIPTION (objectui#3408). Reached through the
   * edited control's `aria-describedby`, so focusing it says "12 characters,
   * 500 max" once and then shuts up. Before this the cap was announced only as
   * a side effect of typing — focus told a screen reader user nothing at all
   * that a sighted user could read off the corner of the box.
   */
  const description = t('fields.textarea.characterCount', { count: length, max: maxLength });

  /**
   * The near-limit warning, gated. Silent for the whole comfortable middle of
   * the field — a count nobody is close to is not news — and phrased as what
   * is LEFT rather than what has been typed, because that is the number the
   * user is about to act on. Over-long values (a cap lowered after the record
   * was saved) clamp to 0: the textarea's own `maxLength` blocks further
   * input, so "0 left" is the true actionable state, and the description above
   * still carries the honest `503 of 500`.
   *
   * Short-circuited by `announceNearLimit` rather than only hidden at render
   * time, so a surface that renders no status region also schedules no timer —
   * a debounce firing into a region that does not exist is a state update with
   * no consumer, and in tests an `act()` warning with no cause.
   */
  const pendingStatus =
    announceNearLimit && maxLength - length <= counterStatusThreshold(maxLength)
      ? t('fields.textarea.charactersRemaining', { count: Math.max(maxLength - length, 0) })
      : '';

  /**
   * The last sentence a PAUSE settled on. Only ever written by the timer —
   * never cleared synchronously — so this effect adds no cascading render on
   * the keystrokes it is busy staying quiet through
   * (`react-hooks/set-state-in-effect`).
   */
  const [settledStatus, setSettledStatus] = useState('');

  useEffect(() => {
    if (!pendingStatus) return;
    const timer = setTimeout(() => setSettledStatus(pendingStatus), COUNTER_STATUS_DEBOUNCE_MS);
    // Every keystroke cancels the previous pending announcement, so a typist
    // who never pauses is never interrupted. The dependency is the SENTENCE,
    // not the length: re-typing back to the same count produces the same string
    // and therefore no DOM change and no second announcement.
    return () => clearTimeout(timer);
  }, [pendingStatus]);

  /**
   * Speak the settled sentence only while it is still TRUE — i.e. while it is
   * the one the current value would produce. Everything else renders empty,
   * which costs no speech (emptying a live region announces nothing), and that
   * is what makes leaving the warning band silent IMMEDIATELY rather than a
   * second later.
   *
   * The obvious alternative, `pendingStatus ? settledStatus : ''`, is wrong in
   * one specific way: delete back out of the band and type into it again, and
   * the region re-announces the STALE count from before the excursion a full
   * second before the timer corrects it. Announcing a wrong number is worse
   * than announcing a right one twice, which is the bounded, sub-second,
   * correct-content cost of the comparison below. Pinned by `never
   * re-announces the STALE count when the user types back into the band`.
   */
  const status = settledStatus === pendingStatus ? pendingStatus : '';

  return (
    <>
      {/*
        The VISIBLE counter, and visible ONLY (objectui#3408). It used to be
        three things at once: the digits a sighted user glances at, the carrier
        of the translated sentence (objectui#3406), and the live region itself —
        so the sentence was re-announced on every single keystroke. Split into
        the three nodes here, this one is decorative: `aria-hidden` keeps a
        screen reader from reading "5 slash 200" on top of the description that
        says it properly.
      */}
      <div className={className} aria-hidden="true" data-testid={testId}>
        {length}/{maxLength}
      </div>

      {/*
        The DESCRIPTION. Referenced by the edited control's `aria-describedby`,
        never announced on its own — a screen reader reads it when focus lands
        on the control and not again. Visually hidden because the digits above
        already say it to the eye.
      */}
      <span id={descriptionId} className="sr-only">
        {description}
      </span>

      {/*
        The STATUS region, on the surfaces that opted in. Rendered
        unconditionally there and starting EMPTY on purpose: a live region has
        to be in the DOM before its content changes or the first change is not
        announced at all. `aria-atomic` so the whole sentence is spoken rather
        than the digits that differ from last time.
      */}
      {announceNearLimit && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {status}
        </span>
      )}
    </>
  );
}

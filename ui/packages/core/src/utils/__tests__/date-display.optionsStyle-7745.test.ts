/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7745 — `formatDate` reads `options.style`, and the precedence
 * against its same-named positional parameter is PINNED.
 *
 * ── What was measured, at head `a617bb8d3` ──────────────────────────────────
 * `DateDisplayOptions` is the ONE bag `formatDate` / `formatRelativeDate` /
 * `formatDateTime` share. PR #7621 added `style?: string` to it and only
 * `formatDateTime` read it, so on `formatDate` the key was inert — and inert
 * next to a POSITIONAL parameter of the same name:
 *
 *   | call                                                     | before        |
 *   | -------------------------------------------------------- | ------------- |
 *   | `formatDate(v, undefined, { style: 'short', locale })`    | `Jul 4, 2024` |
 *   | `formatDate(v, 'short', { locale })`                      | `Jul 4, '24`  |
 *
 * One function, two spellings for one concept, one of them silently doing
 * nothing — and the silent one is the spelling `formatDateTime` REQUIRES. The
 * maintainer's ruling B on objectui#7443 (comment 5539935824) names the
 * long-run shape: both functions accepting `options.style`, additive on
 * `formatDate`. This file is that step's pin.
 *
 * ── The precedence, and why this direction ─────────────────────────────────
 * **The positional argument wins**; `options.style` is consulted only when the
 * positional slot is `undefined`. It is the only direction that is purely
 * ADDITIVE: it fires exactly on the input that is a silent no-op today, so no
 * call that renders a face today renders a different one after. The reverse
 * would let a key aimed at a SIBLING function (the bag is shared, and
 * `dueLike` / `t` are read by `formatRelativeDate` alone) outrank an argument
 * the caller wrote for THIS call — objectui#7694's shape, and the silent
 * override half of objectui#4272. `??` and not `||`, so `''` still counts as
 * given and keeps rendering the default face.
 *
 * ── Directions, predicted in writing BEFORE the run ────────────────────────
 *   Reverting the read (`style ?? options?.style` → `style`)
 *       RED: every case in "the options spelling is read at all" and in "the
 *       options spelling IS the positional spelling"; the precedence cases
 *       stay GREEN (positional still wins by absence of any competitor), and
 *       so does everything under "nothing that renders a face today moves".
 *   Inverting the precedence (`options?.style ?? style`)
 *       RED: only "the positional argument wins"; the additive cases stay
 *       GREEN. This is the pair that makes the two halves independently
 *       falsifiable — neither mutation can turn both red.
 *   Dropping the `absoluteFallbackOptions` strip in `formatRelativeDate`
 *       RED: "`formatRelativeDate` still does not read `style`" (its
 *       out-of-window fallback would start honouring it), the
 *       non-recursion case (`{ style: 'relative' }` blows the stack), and —
 *       since objectui#8262 — the OUT-of-window precedence case below.
 *
 * ── objectui#8262 — the out-of-window half of the sharpest pair ─────────────
 * The pair at "beats it on the sharpest pair" was measured only INSIDE the
 * ±7-day window, where `formatDate(v, 'relative', …)` produces the relative
 * phrase locally and never reaches the absolute fallback. Outside the window
 * the same call round-trips through `formatRelativeDate` and back into
 * `formatDate`, carrying the shared bag — a second place the losing spelling
 * could take effect, and the one `formatDate`'s own precedence pin could not
 * see. "beats it OUT of window too" is that half; it is what keeps the #7745
 * ruling two-sided if the strip is ever flipped (objectui#7816, ruled A —
 * `formatRelativeDate` stays style-less — so nothing lands there today).
 */
import { describe, it, expect } from 'vitest';

import { formatDate, formatDateTime, formatRelativeDate } from '../date-display';

/** The card's instant and locale, in the card's face. A non-current year, so
 *  the "drop the year" branch of the default face is not in play. */
const V = '2024-07-04T07:00:00.000Z';
const L = 'en-US';

/** A date INSIDE the ±7-day relative window, so the relative path produces a
 *  relative phrase rather than delegating to the absolute face. */
function inTwoDays(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d;
}

describe('formatDate reads options.style (#7745)', () => {
  it('the options spelling is read at all — the card\'s before/after reading', () => {
    // Before this change this was `Jul 4, 2024`: the default face, no diagnostic.
    expect(formatDate(V, undefined, { style: 'short', locale: L })).toBe("Jul 4, '24");
  });

  it('the options spelling IS the positional spelling, for every face', () => {
    // Stated as an equivalence rather than three literals: the property is
    // "one concept, one behaviour", so a redesign of a face moves both sides.
    for (const style of ['short', 'relative', 'long', 'compact'] as const) {
      expect(formatDate(V, undefined, { style, locale: L })).toBe(formatDate(V, style, { locale: L }));
    }
    // ... anchored by the two literals the card measured, so a redesign that
    // moved both sides together could not pass silently.
    expect(formatDate(V, undefined, { style: 'short', locale: L })).toBe("Jul 4, '24");
    expect(formatDate(V, undefined, { style: 'long', locale: L })).toBe('Jul 4, 2024');
  });

  it('reaches the relative branch too, not just the short one', () => {
    const soon = inTwoDays();
    expect(formatDate(soon, undefined, { style: 'relative', locale: L })).toBe(
      formatRelativeDate(soon, { locale: L }),
    );
    // And that is genuinely the relative phrase, not the absolute face.
    expect(formatDate(soon, undefined, { style: 'relative', locale: L })).not.toBe(
      formatDate(soon, undefined, { locale: L }),
    );
  });
});

describe('the precedence between the two spellings is pinned: positional wins (#7745)', () => {
  it('the positional argument beats options.style', () => {
    expect(formatDate(V, 'short', { style: 'long', locale: L })).toBe("Jul 4, '24");
    expect(formatDate(V, 'long', { style: 'short', locale: L })).toBe('Jul 4, 2024');
  });

  it('beats it on the sharpest pair — where the loser would be VISIBLY different', () => {
    const soon = inTwoDays();
    // options-wins would render the relative phrase ("In 2 days") here.
    expect(formatDate(soon, 'short', { style: 'relative', locale: L })).toBe(
      formatDate(soon, 'short', { locale: L }),
    );
    // options-wins would render the compact-year short face here.
    expect(formatDate(soon, 'relative', { style: 'short', locale: L })).toBe(
      formatRelativeDate(soon, { locale: L }),
    );
  });

  it('beats it OUT of window too — on the delegated absolute face (#8262)', () => {
    // The out-of-window sibling of the case above, and the reason it is a
    // separate case: `V` is years old, so `formatDate(V, 'relative', …)` does
    // NOT render its face here — it calls `formatRelativeDate`, which is past
    // its ±7-day window and delegates BACK into `formatDate` for the absolute
    // face, carrying the shared bag the whole way. That round trip is a second
    // site at which the losing spelling could take effect, and the in-window
    // case cannot reach it.
    //
    // Positional `'relative'` was the only face selector consulted, so what
    // comes out is the default absolute face — stated as the equivalence
    // first, because that half holds in any time zone.
    expect(formatDate(V, 'relative', { style: 'short', locale: L })).toBe(
      formatDate(V, undefined, { locale: L }),
    );
    // ⚠️ TZ is an INPUT here, not ambience: `V` is 07:00Z and every face in
    // this module is built from LOCAL date parts, so the literal below reads
    // `Jul 4` in UTC and in every zone from UTC-07:00 eastward, and `Jul 3`
    // west of it. The repo pins no `TZ` (none in `vitest.config.mts`, none in
    // any workflow); CI and this container both resolve `UTC`. The two
    // equivalences around it are TZ-free and carry the property on their own.
    expect(formatDate(V, 'relative', { style: 'short', locale: L })).toBe('Jul 4, 2024');
    // The named loser, with its own lit control immediately before it — a
    // `not.toBe` against a face that renders nothing would pass for free.
    expect(formatDate(V, 'short', { locale: L })).toBe("Jul 4, '24");
    expect(formatDate(V, 'relative', { style: 'short', locale: L })).not.toBe(
      formatDate(V, 'short', { locale: L }),
    );
  });

  it('"absent" means `undefined`, not "falsy" — `\'\'` still counts as given', () => {
    // `??`, not `||`. `formatDate(v, '', bag)` renders the default face today
    // and must keep doing so; falling through to the key would change it.
    expect(formatDate(V, '', { style: 'short', locale: L })).toBe('Jul 4, 2024');
    expect(formatDate(V, '', { style: 'short', locale: L })).toBe(formatDate(V, '', { locale: L }));
  });

  it('the positional slot still exists — arity pin', () => {
    // Turns RED the moment the positional parameter is dropped, which would
    // silently move every `formatDate(v, 'short', opts)` caller's arguments.
    expect(formatDate.length).toBe(3);
  });
});

describe('nothing that renders a face today moves (#7745 is additive)', () => {
  it('every positional call renders exactly what it rendered before', () => {
    expect(formatDate(V, 'short', { locale: L })).toBe("Jul 4, '24");
    expect(formatDate(V, undefined, { locale: L })).toBe('Jul 4, 2024');
    expect(formatDate(V, 'relative', { locale: L })).toBe('Jul 4, 2024');
    expect(formatDate('', undefined, { locale: L })).toBe('—');
    expect(formatDate('not a date', undefined, { locale: L })).toBe('—');
  });

  it('the two OTHER inert keys stay exactly as inert as they were', () => {
    // `dueLike` is read by `formatRelativeDate` alone, `t` likewise. #7745
    // touches neither, and the reviewer's regression reading is the pin.
    expect(formatDateTime(V, { dueLike: true, t: () => 'X', locale: L })).toBe('Jul 4, 2024, 07:00 AM');
    expect(formatDate(V, undefined, { dueLike: true, t: () => 'X', locale: L })).toBe('Jul 4, 2024');
  });

  it('formatDateTime keeps its own reading of the same key', () => {
    expect(formatDateTime(V, { style: 'compact', locale: L })).toBe('7/4/2024 7:00 am');
    expect(formatDateTime(V, { locale: L })).toBe('Jul 4, 2024, 07:00 AM');
  });

  it('a bag built for formatDateTime lands on formatDate as the default face', () => {
    // The shared bag can legitimately carry a sibling's key. `'compact'` is
    // not `formatDate`'s vocabulary, so it is "anything else" — the default.
    expect(formatDate(V, undefined, { style: 'compact', locale: L })).toBe('Jul 4, 2024');
  });
});

describe('formatRelativeDate still does not read `style` (#7745 does not touch it)', () => {
  it('ignores it inside the ±7-day window', () => {
    const soon = inTwoDays();
    expect(formatRelativeDate(soon, { style: 'short', locale: L })).toBe(
      formatRelativeDate(soon, { locale: L }),
    );
  });

  it('ignores it on the out-of-window ABSOLUTE fallback too', () => {
    // This is the edge `formatDate`'s new read would have leaked through:
    // beyond ±7 days `formatRelativeDate` delegates to `formatDate`, so
    // without the strip the key would take effect HERE and nowhere else.
    expect(formatRelativeDate(V, { style: 'short', locale: L })).toBe('Jul 4, 2024');
    expect(formatRelativeDate(V, { style: 'compact', locale: L })).toBe('Jul 4, 2024');
  });

  it('does not recurse when the bag carries `style: \'relative\'`', () => {
    // `formatDate` resolves `'relative'` by calling `formatRelativeDate`,
    // which delegates back for out-of-window dates. With the style still in
    // the bag that is an unbounded loop, not a face.
    expect(() => formatRelativeDate(V, { style: 'relative', locale: L })).not.toThrow();
    expect(formatRelativeDate(V, { style: 'relative', locale: L })).toBe('Jul 4, 2024');
    expect(() => formatDate(V, undefined, { style: 'relative', locale: L })).not.toThrow();
    expect(formatDate(V, undefined, { style: 'relative', locale: L })).toBe('Jul 4, 2024');
  });
});

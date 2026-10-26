/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEASURED record for `type="number"` widgets, in ONE place
 * (objectui#6765 measured the emissions, objectui#6780 measured `badInput`).
 *
 * Not a `.test.ts` file: it holds no assertions, only the numbers, so the two
 * suites that read it cannot drift into two dialects of "what a browser does".
 * The vitest project globs are `packages/**\/*.test.ts(x)`, so nothing here is
 * collected as a test.
 *
 * Chromium 141.0.7390.37 via Playwright 1.62.1, `executablePath:
 * '/opt/pw-browsers/chromium'`, a real page served over `http://127.0.0.1`
 * (a secure context, so the real clipboard works), driven key by key.
 * happy-dom 20.11.2, this package's test environment.
 */

/**
 * Every non-empty string a real Chromium was observed to place in
 * `e.target.value` for a `type="number"` input, across keystrokes, real
 * clipboard paste and programmatic set. MEASURED, not enumerated from the spec.
 */
export const BROWSER_READINGS = ['12', '1.23', '010', '15', '1', '12.345'] as const;

/**
 * Strings only the TEST environment can produce, because happy-dom does not
 * implement the HTML value-sanitization algorithm (objectui#6765).
 */
export const HAPPY_DOM_FABRICATIONS = ['12abc', '1.2.3', '0x10', '1e'] as const;

/* -------------------------------------------------------------------------- */
/* objectui#6780 — the `badInput` agreement, measured rather than assumed.     */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ CORRECTION TO THE RECORD (objectui#6780, measured on `d06059f24`).
 *
 * objectui#6765 / PR #6777 recorded that `validity.badInput` is "the ONE signal
 * about unreadable text that agrees between this environment and the browser".
 * That is TRUE for the case the card reproduced, and it is the reason option A
 * is testable at all — but as a general statement it is too strong, and the
 * difference decides which strings a unit test may honestly drive.
 *
 * The full matrix, measured on both engines:
 *
 * ```
 *            Chromium TYPED        Chromium .value=x     happy-dom .value=x
 * input      .value   badInput     .value   badInput     .value    badInput
 * "1e"       ""       TRUE         ""       false        "1e"      TRUE
 * "1e-"      ""       TRUE         ""       false        "1e-"     TRUE
 * "1e+"      ""       TRUE         ""       false        "1e+"     TRUE
 * "5e"       ""       TRUE         ""       false        "5e"      TRUE
 * "-"        ""       TRUE         ""       false        ""        false   <-
 * "."        ""       TRUE         ""       false        ""        false   <-
 * "+"        ""       TRUE         ""       false        ""        false   <-
 * "-."       ""       TRUE         ""       false        ""        false   <-
 * "e"        ""       TRUE         ""       false        ""        false   <-
 * "1."       "1"      false        ""       false        "1."      TRUE    <-
 * "1e5"      "1e5"    false        "1e5"    false        "1e5"     TRUE    <-
 * "1.2.3"    "1.23"   false        ""       false        "1.2.3"   TRUE    <-
 * "0x10"     "010"    false        ""       false        "0x10"    TRUE    <-
 * "12abc"    "12"     false        ""       false        "12abc"   TRUE    <-
 * ""         ""       false        ""       false        ""        false
 * "12"       "12"     false        "12"     false        "12"      false
 * ```
 *
 * Two facts the old one-liner hides:
 *
 *  1. ⭐ **In Chromium, `badInput` is NEVER true for a programmatic `.value`
 *     write.** Per the HTML definition it reports that the UA cannot convert
 *     *the user's input*; a script write has no user input to fail on. So on
 *     the route a unit test actually has — `fireEvent.change`, which sets
 *     `.value` and dispatches — Chromium answers `false` for every string,
 *     and happy-dom answers `true` for nine of them. On the SAME route the two
 *     engines agree on nothing.
 *  2. The agreement that does exist, and that this guard rests on, is between
 *     happy-dom's programmatic verdict and Chromium's TYPED verdict. It holds
 *     for a real subset, and fails for eight inputs (marked `<-`).
 *
 * ⇒ A unit test for the announcement may drive ONLY strings where those two
 * verdicts match. That is what the two lists below are for. Driving `0x10` or
 * `12abc` would make a happy-dom test go green over a branch the product never
 * executes — the exact failure objectui#6765 exists to prevent.
 */

/**
 * Strings where happy-dom's `.value = x` and Chromium's TYPED verdict BOTH say
 * `badInput`. The only inputs a unit test may use to drive the announcement.
 */
export const BAD_INPUT_AGREED = ['1e', '1e-', '1e+', '5e'] as const;

/**
 * Strings where both engines agree there is NO bad input — so the guard must
 * stay quiet. `''` is included deliberately: an empty box is a CLEARED field,
 * not unreadable text, and announcing there would fire on every deletion.
 */
export const BAD_INPUT_AGREED_CLEAN = ['12', '1.23', '010', '15', '1', '12.345', ''] as const;

/**
 * The eight inputs where the two engines DISAGREE about `badInput`, pinned so
 * that nobody later "extends coverage" by adding one to the lists above.
 *
 * `chromiumTyped` is what a real Chromium reports when a user types the string
 * key by key; `happyDom` is what this test environment reports for
 * `input.value = string`.
 */
export const BAD_INPUT_DISAGREEMENTS: ReadonlyArray<{
  input: string;
  chromiumTyped: boolean;
  happyDom: boolean;
}> = [
  // Chromium: a lone sign / dot / exponent letter is unreadable USER input.
  // happy-dom sanitizes them away to `''` and then sees nothing wrong.
  { input: '-', chromiumTyped: true, happyDom: false },
  { input: '.', chromiumTyped: true, happyDom: false },
  { input: '+', chromiumTyped: true, happyDom: false },
  { input: '-.', chromiumTyped: true, happyDom: false },
  { input: 'e', chromiumTyped: true, happyDom: false },
  // The other direction: happy-dom keeps residue and calls it bad, while a
  // real browser filtered or accepted the same keystrokes long before.
  { input: '1.', chromiumTyped: false, happyDom: true },
  { input: '1e5', chromiumTyped: false, happyDom: true },
  { input: '12abc', chromiumTyped: false, happyDom: true },
];

/**
 * Every state a real keyboard can reach that leaves Chromium unable to read the
 * box — MEASURED by typing each one key by key into an empty `type="number"`
 * input. This is the list that makes the guard a real fix rather than
 * objectui#6715's provable no-op: all nine are reachable by a user, and the box
 * VISIBLY displays them (screenshot-compared against an untouched box) while
 * `.value` reads `''`.
 *
 * ⚠️ Only the first four are unit-testable (see {@link BAD_INPUT_AGREED}); the
 * rest are product behaviour this environment cannot reproduce.
 */
export const CHROMIUM_KEYBOARD_REACHABLE_BAD_INPUT = [
  '1e', '1e-', '1e+', '5e', '-', '.', '+', '-.', 'e',
] as const;

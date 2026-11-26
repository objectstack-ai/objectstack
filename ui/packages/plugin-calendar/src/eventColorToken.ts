/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Tokens that already look like Tailwind colour utilities (`bg-*-500`,
 * `bg-blue-500 text-white`, `text-*`, …). `CalendarView` passes them through
 * as the event's classes; `ObjectCalendar` hands one on raw when no option
 * colour answers, because a utility string is itself a colour. A palette
 * family name stored as a record value is data, not a declaration, and is
 * never handed on (objectstack#36882).
 *
 * Its own module, not `CalendarView`: the tests that mock `./CalendarView`
 * must not have to restate it.
 */
const TAILWIND_TOKEN_RE = /(^|\s)(bg|text|from|to|via)-/;

/** Whether a raw value already is a Tailwind colour utility string. */
export function isTailwindColorToken(raw: unknown): raw is string {
  return typeof raw === 'string' && TAILWIND_TOKEN_RE.test(raw);
}

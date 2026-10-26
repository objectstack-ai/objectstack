/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * displayLocale — the one place this package spells the display locale's LAST
 * RESORT, and the one place it formats a number with a THREADED tag.
 *
 * Two module-private copies of both used to be the alternative (`formatValue`
 * and `LiveReportExporter` each hard-coded `'en-US'`), which is how the
 * divergence objectui#10020 records happened in the first place: a package can
 * only contradict a contract it states in more than one place.
 */

/**
 * `'en'` — the tag `useDisplayLocale` (`@object-ui/i18n`) itself falls back to
 * when neither the tenant's regional default nor the active UI language
 * answers. Quoted from that hook's contract, which names BOTH alternatives as
 * wrong answers:
 *
 *   > `'en'` — a concrete last resort rather than `undefined`. `undefined`
 *   > would hand `Intl` the *machine's* locale, which is invisible in review
 *   > and non-deterministic in CI; `'en'` at least fails the same way
 *   > everywhere. Note this is `'en'`, not `'en-US'`: the point of
 *   > objectui#4033 is that `en-US` is not the world's default.
 *
 * So this constant may become neither `'en-US'` (the tag objectui#10020 removed
 * from five display sites in this package) nor `undefined` (objectui#9909's
 * separate defect shape, which `ReportExportEngine.ts`'s "Generated:" time
 * carried until that card threaded a locale there, defaulting to this same
 * constant).
 *
 * ⚠️ It is a local re-spelling of that literal, not an import of it:
 * `@object-ui/i18n` exports the HOOK but no constant for the tag inside it, and
 * a plain formatter cannot call a hook. Anything that moves the contract's last
 * resort has to move this line too — pinned from the behavioural side by
 * `__tests__/reportDisplayLocale-10020.test.tsx`, which asserts the omitted
 * argument agrees with an explicit `'en'`.
 */
export const DISPLAY_LOCALE_LAST_RESORT = 'en';

/**
 * `Number.prototype.toLocaleString` with a tag that came from OUTSIDE this
 * module.
 *
 * The retry is load-bearing rather than defensive, and it is the threading
 * itself that makes it so: a hard-coded literal can never be malformed, while a
 * threaded tag originates in tenant configuration (ADR-0053) and reaches here
 * verbatim. `Intl` throws `RangeError` on a malformed tag — measured on
 * `'en_US'`, underscore instead of hyphen, the likeliest such typo — and these
 * call sites are inside a cell render, so an uncaught throw takes the whole
 * report down rather than misformatting one number.
 *
 * ⚠️ The degradation is to {@link DISPLAY_LOCALE_LAST_RESORT}, NOT to a dropped
 * tag, because this package's display tags follow `useDisplayLocale`'s
 * contract: in React the tag IS that hook's value, and an omitted one defaults
 * to the hook's own last resort. Under that contract, dropping the tag hands
 * `Intl` the machine's locale — the other answer the contract quoted above
 * rules out, non-deterministic in CI and invisible in review.
 *
 * `@object-ui/core`'s sibling retry (`formatNumberInLocale`, through
 * `formatDisplayNumber`) drops the tag instead. That is a deliberate
 * difference, not an oversight, and not a wrong answer: `core` is the
 * React-free formatter, and where its retry lands is what its own declared
 * contract (`DisplayNumberFormatOptions.locale`) gives a caller with no tag in
 * hand — the runtime default, the viewer's own environment. Each retry follows
 * its own package's declared contract (objectui#10098).
 */
export function formatNumberInDisplayLocale(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return value.toLocaleString(locale, options);
  } catch {
    return value.toLocaleString(DISPLAY_LOCALE_LAST_RESORT, options);
  }
}

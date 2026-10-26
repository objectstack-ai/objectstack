/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RE-EXPORT ONLY — the implementation moved to `@object-ui/core`
 * (`utils/number-display.ts`) in objectui#4576. Read it there; nothing is
 * redeclared here, so there is no second copy to drift.
 *
 * Why it moved: `@object-ui/core`'s `dataset-format.ts` needs this exact
 * policy, and it could not import it while it lived here — `core` is the
 * React-free engine and this package depends on `i18next`/`react-i18next` and
 * peer-depends on React. So `formatMeasure` kept a parallel `Intl`
 * implementation, and the two drifted apart in the one place `Intl` and a
 * hand-built string disagree: a German session read `1.234,5 %` from a list
 * cell beside `1.234,5%` from a dashboard measure (objectui#4576). The function
 * is pure, so the boundary was never a property of the code — only of where the
 * code sat. Moving it DOWN removed the obstacle; this package gained a
 * dependency on `@object-ui/core` (no cycle: `core` imports nothing from here).
 *
 * This file survives as a re-export rather than being deleted so that BOTH
 * historical import paths keep working byte-compatibly — the package entry
 * (`@object-ui/i18n`, used by `fields`, `components` and `plugin-dashboard`)
 * and the relative `../utils/number-display` this package's own suite uses.
 * `number-display.reexport-identity.test.ts` pins that the two paths resolve to
 * the SAME function object and the same type, so a future edit cannot quietly
 * reintroduce a copy.
 */

export {
  formatDisplayNumber,
  shouldGroupDisplayNumber,
  type DisplayNumberFormatOptions,
} from '@object-ui/core';

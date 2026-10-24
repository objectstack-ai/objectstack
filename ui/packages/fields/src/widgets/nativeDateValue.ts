/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Value adapters for the native date/time controls (objectui#3127).
 *
 * They live in `@object-ui/core` (`utils/native-date-value.ts`), next to the
 * `isRealCalendarDate` judgement they share, so `@object-ui/components`' data
 * table can use the same set without a package cycle (objectui#10625). This
 * module re-exports them unchanged, so every importer here, and the public
 * `@object-ui/fields` barrel, names the same symbols as before. The design
 * notes (the round trip, the shape kept in form state, the impossible stored
 * day) are in the `core` module's header.
 */

export {
  toDateInputValue,
  toDateTimeInputValue,
  fromDateTimeInputValue,
  isImpossibleStoredDay,
} from '@object-ui/core';

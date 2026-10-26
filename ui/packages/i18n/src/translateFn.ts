/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * i18next's `t`, narrowed to the one call shape a plain helper needs: a key,
 * optional interpolation / `defaultValue` options, and a string back.
 *
 * ⭐ This is the ONE authority for the name (objectui#8261, executing the
 * maintainer's ruling on objectui#8165, option A). A module that is handed a
 * `t` rather than calling a translation hook itself — a toast emitter, a size
 * guard, a message builder — types that parameter with this and imports it.
 * ⛔ It does not declare its own copy: `@object-ui/app-shell` and
 * `@object-ui/fields` each carried a byte-identical one until this change, and
 * both now re-export this declaration instead
 * (`export type { TranslateFn } from '@object-ui/i18n'`).
 *
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` is what
 * re-derives that there is one authority: it reads such a re-export as a
 * re-export, and a second `export type TranslateFn = …` anywhere in a
 * published package's source as a collision.
 *
 * Why this package and not `@object-ui/types`: it is a translation-function
 * shape, not a schema type — the ruling's own ground.
 */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

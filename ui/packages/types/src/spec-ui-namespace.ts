/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `UI` protocol namespace of `@object-ui/types` — the module behind
 * `export type * as UI` in `index.ts`.
 *
 * Existence note (objectui#5716). `index.ts` used to point that namespace
 * export straight at `@objectstack/spec/ui`, so the namespace tracked
 * whatever the installed pin publishes — and on the dependency refresh past
 * the spec's theme retirement (objectstack `35ad101bc`), the `UI.Theme`-family
 * members would have vanished with no error anywhere in this repo. The
 * objectui#5716 ruling says that silent narrowing must stop for the theme
 * family. This shim is the mechanism: an explicit re-export beats a star
 * re-export of the same name, so the three theme document types below resolve
 * to their owner (`./theme.ts`) — today, while the pin still publishes the
 * retired names, and unchanged after the refresh removes them from the star.
 *
 * The REST of the namespace still tracks the spec by star — deliberately the
 * same posture as the non-theme `@objectstack/spec/ui` re-export blocks in
 * `index.ts`, which the same ruling left out of scope. Spec/ui names the
 * refresh retires (`ThemeSchema`, `ThemeModeSchema`, `ThemeParsed`,
 * `Typography`, `BorderRadius`, `Shadow`, `defineTheme`) drop out of the star
 * with it; the named-type deletions on this package's own surface are
 * recorded in the objectui#5716 changeset.
 */
// The star below is the sanctioned namespace re-export of the spec vocabulary
// (moved here from `index.ts:978`); the no-restricted-imports entry it trips
// guards named `FormField` imports, which a star cannot prove absent.
// eslint-disable-next-line no-restricted-imports
export type * from '@objectstack/spec/ui';
export type { Theme, ThemeMode, ColorPalette } from './theme.js';

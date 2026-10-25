/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How the CLI spells the place a Zod issue points at: the path's segments
 * joined with ` → `, or `(root)` when the path is empty.
 *
 * `objectui validate` prints it on every issue's `Path:` line, and
 * `objectui check` prints it on the one issue line it gives each file that did
 * not validate (objectui#11007). It is one function so the two commands cannot
 * drift into two spellings of the same place.
 *
 * `(root)` is parenthesised so it cannot be read as a real key literally named
 * `root` — a genuine path to one prints as `root`. An empty path used to drop
 * the line altogether in `validate`, silent in exactly the case a reader most
 * needs oriented (`85b495795`).
 */
export function formatIssuePath(path: readonly PropertyKey[] | undefined): string {
  const segments = path ?? [];
  return segments.length > 0 ? segments.join(' → ') : '(root)';
}

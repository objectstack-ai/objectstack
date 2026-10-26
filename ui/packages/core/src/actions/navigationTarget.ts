/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What a click may navigate to, and how.
 *
 * This is the one answer, shared by every caller that turns an authored or
 * served target into a user-click navigation (objectui#12191, ruling A+):
 *
 * - the action runner: a `type: 'url'` action, its `navigation` alias (which is
 *   how an `element:button` CTA reaches it) and `onSuccess.navigate`;
 * - app-shell's entitlement CTA, `resolveCtaHref`.
 *
 * ⛔ No caller keeps a scheme list of its own. A second list is how the runner
 * came to refuse the `mailto:` target the CTA already admitted, so a mail button
 * the spec accepts published cleanly and then failed at click.
 *
 * The admitted set is closed:
 *
 * - `'web'`: `http://` or `https://`. It leaves the app. The caller's `openIn`
 *   decides the tab.
 * - `'mail'`: `mailto:`. It leaves the app IN PLACE: never a new tab, and
 *   `openIn` is not consulted. The mail client opens and the page stays.
 * - `'path'`: an in-app relative path, `/…` or `./…`.
 *
 * Everything else answers `null` and is refused: `javascript:`, `data:`, `tel:`
 * (not admitted: no measured producer) and every other scheme, and a
 * protocol-relative `//host`. Two other spellings of `//host` are refused with
 * it, because the browser's URL parser reads them as `//host`: a backslash in
 * second place (`/` then a backslash, then `host`), and any target that holds an
 * ASCII tab, line feed or carriage return, since the parser deletes those three
 * before it reads anything.
 *
 * Scheme names compare case-insensitively, as the URL parser compares them.
 */
export type NavigationTargetKind = 'web' | 'mail' | 'path';

export function classifyNavigationTarget(url: unknown): NavigationTargetKind | null {
  if (typeof url !== 'string' || /[\t\n\r]/.test(url)) return null;
  if (/^https?:\/\//i.test(url)) return 'web';
  if (/^mailto:/i.test(url)) return 'mail';
  if (url.startsWith('./')) return 'path';
  if (url.startsWith('/') && url[1] !== '/' && url[1] !== '\\') return 'path';
  return null;
}

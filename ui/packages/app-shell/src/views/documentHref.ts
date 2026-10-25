/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The href a document resolves to the place a router path names, which is the
 * href react-router's own `Link` renders for that path (objectui#12233).
 *
 * `rootHref` is `useHref('/')`, the router's href for its root, so it carries
 * the basename the host mounted the router under: `/_console` on a console the
 * framework serves there, `/` on a root mount. `navigate(path)` applies that
 * basename itself and an anchor's `href` does not. A router path published
 * bare as an href therefore works from a plain left click, which the anchor
 * hands to the SPA, and from nothing else: a new tab, a middle-click or a
 * copied link resolves it against the origin, outside the console.
 *
 * The one join for every host that publishes
 * `RelatedRecordActionsValue.recordHref`: the record page's
 * `RelatedRecordActionsBridge` and the custom page's `pageRecordActionsValue`.
 * Internal to this package: keep it out of the package entry and its barrels.
 */
export function documentHref(rootHref: string, routerPath: string): string {
  return `${rootHref.replace(/\/+$/, '')}${routerPath}`;
}

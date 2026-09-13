// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17063 (ADR-0049 enforce-or-remove; maintainer ruling 2026-09-09, decision
// batch #107 item 1, verbatim 「撤」). `ObjectListView.pageName` named the published
// page a `type: 'page'` view was to mount. Only the spec half of #13216 ever
// landed: no renderer read the key, so the named page was never reached and the
// view drew an empty grid. Tombstoned with `retiredKey()` beside the
// `virtualScroll` tombstone already on this shape; the enum VALUE `'page'` went
// with it, carrying its own prescription on the `type` enum's error map. The
// surviving page mount is the app navigation item (`PageNavItem.pageName`),
// which is a different key on a different surface and has always rendered. D2:
// `view-page-mount-removed`.
export const entry = 'ui/ObjectListView:pageName';

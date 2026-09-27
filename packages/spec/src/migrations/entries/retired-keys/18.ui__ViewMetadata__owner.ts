// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20230 — the overlay door's `owner`, the sibling of `ui/ViewMetadata:hidden`
// (see that row for the measurement and the registration's def key). It named
// a user nothing ever read: no per-user scope exists for a view (ADR-0017,
// parked), so an overlay marked as one user's changed nothing for anyone.
// Tombstoned with `retiredKey()` on both overlay members, with the view item's
// own prescription text. Same blind spot as its sibling: the def is unemitted,
// so no gate judges this row. D2: `view-overlay-owner-hidden-removed`.
export const entry = 'ui/ViewMetadata:owner';

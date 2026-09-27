// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20085 (ADR-0049 enforce-or-remove; triage direction 「retire both keys」).
// `ViewItem.owner` named the user a `personal` view item belonged to, and
// nothing ever read it: no writer and no reader of the view-item key in the
// framework, in objectui at its pin and at `main`, or in cloud, and both
// switcher read paths filter on `viewKind` + `object` only — so a view marked
// as one user's was listed for everyone who can read the object. Per-user view
// scoping is a parked direction (ADR-0017, amended 2026-09-04). Tombstoned with
// `retiredKey()` on the shared `viewItemBaseShape()`, because that shape also
// feeds the `.strip()` wire member (`ui/ViewItemWire`, registered beside this
// row), where a bare deletion would strip in silence. ⚠️ No gate below can
// JUDGE this row: `ui/ViewItem` is a discriminated union, whose emitted JSON
// Schema has no top-level `properties`, so `authorable-surface/` carries no
// `ui/ViewItem:*` line and check (b) never sees the tombstone — the row is
// declared, not checked. D2: `view-item-owner-hidden-removed`.
export const entry = 'ui/ViewItem:owner';

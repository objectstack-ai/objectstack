// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20085 (ADR-0049 enforce-or-remove; triage direction 「retire both keys」).
// `ViewItem.hidden` promised to hide a view item from the switcher, and nothing
// ever read it: no writer and no reader of the view-item key in the framework,
// in objectui at its pin and at `main`, or in cloud, and both switcher read
// paths filter on `viewKind` + `object` only — `hidden: true` hid nothing.
// Tombstoned with `retiredKey()` on the shared `viewItemBaseShape()`, because
// that shape also feeds the `.strip()` wire member (`ui/ViewItemWire`,
// registered beside this row), where a bare deletion would strip in silence.
// The flattened-overlay members declare their own `hidden` on a different door,
// untouched. ⚠️ No gate below can JUDGE this row: `ui/ViewItem` is a
// discriminated union, whose emitted JSON Schema has no top-level
// `properties`, so `authorable-surface/` carries no `ui/ViewItem:*` line and
// check (b) never sees the tombstone — the row is declared, not checked.
// D2: `view-item-owner-hidden-removed`.
export const entry = 'ui/ViewItem:hidden';

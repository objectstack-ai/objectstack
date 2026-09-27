// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20230 (ADR-0049 enforce-or-remove; triage direction 「follow #20085's
// disposition for the same key pair」). The flattened view overlay's `hidden` —
// the lean personalization PUT with no `config`, members 3 and 4 of the `view`
// union `saveMetaItem` validates — was declared by `flattenedViewOverlayFields()`
// separately from the view item's, accepted, stored verbatim, and read by
// nothing: both switcher read paths filter on `viewKind` + `object` only, so a
// `hidden: true` overlay hid no view. No writer in this framework, its examples,
// objectui at its pin and at `main`, or the HotCRM app (cloud not reachable).
// Tombstoned with `retiredKey()` on both overlay members, with the view item's
// own prescription text; `.strip()` members, so a bare deletion would have
// dropped the key in silence. Registered under `ui/ViewMetadata`, the exported
// door the overlay members are reached through (the members themselves are not
// exported). ⚠️ No gate below can JUDGE this row: `ui/ViewMetadata` is in
// `unemitted-schemas.baseline.json` (its `config: z.undefined()` guards have no
// JSON Schema form), so `authorable-surface/` carries no `ui/ViewMetadata:*`
// line and check (b) never sees the tombstone — the row is declared, not
// checked. D2: `view-overlay-owner-hidden-removed`.
export const entry = 'ui/ViewMetadata:hidden';

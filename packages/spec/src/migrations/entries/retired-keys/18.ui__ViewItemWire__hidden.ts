// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20085 — the wire carrier of `ui/ViewItem:hidden` (see that row for the
// measurement). `ViewItemWireSchema` is member 1 of the `view` union
// `saveMetaItem` validates; it is built from the same `viewItemBaseShape()`, so
// the one tombstone refuses the key there too instead of letting `.strip()`
// drop it in silence — registered under both def keys, the
// `integration/DeclarativeConnectorEntry:connectionTimeoutMs` precedent. Same
// blind spot as its sibling: a discriminated-union def emits no top-level
// `properties`, so no gate judges this row.
// D2: `view-item-owner-hidden-removed`.
export const entry = 'ui/ViewItemWire:hidden';

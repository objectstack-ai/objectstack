// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23543 F4 — ADR-0089 D2, by the maintainer's ruling F4 A on #23543 (record
// 6182001882). `visibleOn` was the form view's first spelling of the
// conditional-visibility predicate; ADR-0089 unified it under `visibleWhen`,
// and through 17 the field schema declared it as a deprecated alias that a
// `.transform` folded onto `visibleWhen` at parse, so the alias was accepted
// without a word. The key retires: a `retiredKey()` tombstone naming
// `visibleWhen`, the fold gone with it. Zero producers measured in this repo's
// examples and apps before the ruling.
//
// Stored rows keep loading through the retired D2 conversion
// `view-visibleOn-to-visibleWhen` (protocol 15), which every stored-row
// rehydration seam replays; the D3 record is `ui-visibility-alias-keys-retired`.
export const entry = 'ui/FormField:visibleOn';

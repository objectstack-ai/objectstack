// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23650 — ADR-0049 enforce-or-remove through the ADR-0087 D2 route (ruling
// record 6203775759, letter A). `PageHeaderProps.showStar` switched a follow
// star the reference console no longer draws: since objectui#12427 the record
// chip draws it only where the host wires `onToggleFavorite`, and no reference
// host does — the record's favorites entry is the header's ⋯ menu. Tombstoned
// with `retiredKey()` in the `strictObject`, beside the `icon` and `breadcrumb`
// this row lost before it (the surface baseline line carries `[RETIRED]`);
// stored and built pages are stripped of both values by the D2 conversion
// `page-header-show-star-removed`, whose D3 record is
// `page-header-show-star-retired`.
//
// ⭐ RETIRED-DEFAULT RESIDUE: not owed, although the key carried
// `.default(true)` — the `breadcrumb` reasoning, unchanged: a page parses its
// component `properties` as an open bag, and this row is parsed only by the
// props lint, which writes nothing back, so no released toolchain emitted
// `showStar: true` into an artifact nobody authored.
export const entry = 'ui/PageHeaderProps:showStar';

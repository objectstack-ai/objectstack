// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20758 — ADR-0049 enforce-or-remove through the ADR-0087 D2 route, the spec
// half of objectui#11166 (triage ruling on the card: RETIRE, no consumer).
// `PageHeaderProps.breadcrumb` switched a trail that never existed: objectui's
// `PageHeaderRenderer` draws an EMPTY `div[data-page-breadcrumb-slot]` unless
// the key is `false`, nothing fills it, and the console draws the navigation
// trail once, in the shell (`AppHeader`). Tombstoned with `retiredKey()` in the
// `strictObject`, beside the `icon` this row lost at 17 (the surface baseline
// line carries `[RETIRED]`); stored and built pages are stripped of both values
// by the D2 conversion `page-header-breadcrumb-removed`, whose D3 record is
// `page-header-breadcrumb-retired`.
//
// ⭐ RETIRED-DEFAULT RESIDUE: not owed, although the key carried
// `.default(true)`. The default was never materialized: a page parses its
// component `properties` as an open bag, and this row is parsed only by the
// advisory props lint, which writes nothing back — so no released toolchain
// emitted `breadcrumb: true` into an artifact nobody authored.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look — the
// `ui/ObjectKanbanProps:quickAdd` precedent.
export const entry = 'ui/PageHeaderProps:breadcrumb';

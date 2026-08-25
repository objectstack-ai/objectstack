// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11805 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-25,
// decision-inbox batch 4: 「#11805 退役 defaultSort,不需要major」; the producer
// half of objectui#5861, under the objectui#4869 「接受所有」 direction).
// `defaultSort` was the legacy second spelling of `object-grid`'s `sort`: a
// single `{ field, order }` pair the renderer read only when `sort` was absent
// (measured at the `.objectui-sha` pin `190fbd01d`,
// `plugin-grid/src/ObjectGrid.tsx:1244-1246` fetch fallback and `:2847`, which
// wraps it `[schema.defaultSort]` — the exact array shape `sort` carries). One
// intent, two spellings; objectui's mirror schema is parity-test-only and
// parses nothing at runtime, so only this repo's strictObject can refuse the
// key. Zero authored occurrences in either repo's corpora (the card's
// measurement, re-run here at dispatch).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent,
// as `data/Metric:filters` before it). Tombstoned with `retiredKey()` in
// `ObjectGridPropsSchema` (the surface baseline line carries `[RETIRED]`);
// sources are rewritten by the D2 conversion `object-grid-default-sort-removed`
// (wrap-and-rename to `sort: [pair]` when `sort` is absent; a pure lossless
// delete when `sort` is present, since the fallback was never read then).
export const entry = 'ui/ObjectGridProps:defaultSort';

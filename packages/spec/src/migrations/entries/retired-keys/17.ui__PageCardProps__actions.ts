// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #6946 — three SDUI page-component props, retired by maintainer ruling
// 2026-08-09 (decision-inbox round, 「全部接受」): objectui#3829 route (c)
// for the first two, objectui#3818 for the third. Registered per key, as
// gate (b) reads them — nothing radiates from a neighbouring key, and this
// family needs that literally: `ui/PageHeaderProps:actions` and
// `ui/RecordHighlightsProps:layout` are LIVE keys sharing these leaf names.
//
// The first two are the B class — declared here, read NOWHERE in objectui
// (the header resolves icons per action; the card renders
// title/bordered/children/footer and has no actions area), and carried in
// that repo's own `UNPUBLISHED_EXEMPTIONS` map as exactly that.
export const entry = 'ui/PageCardProps:actions';

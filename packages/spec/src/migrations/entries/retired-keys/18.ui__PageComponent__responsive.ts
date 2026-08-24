// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11027 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-22, ruled B:
// retire + repair the redirect texts in the same change). The LAST carrier of
// the `ResponsiveConfig` layout block, and the destination the
// `dashboard.widgets[].responsive` tombstone (#4876) prescribed as the live
// alternative. Measured across objectstack + objectui with the tsc-probe
// methodology (positive and negative controls): objectui's two implementations
// of the contract (`useResponsiveConfig` in `@object-ui/mobile`,
// `ResponsiveProtocol` in `@object-ui/core`) had ZERO callers, nothing read
// `.responsive` off a page component, and objectui's own node interface never
// declared the key — so an author following the shipped prescription moved an
// inert key to an inert key and was told it now works. Same retirement the
// family already took on identical evidence: `view.responsive` (#3896),
// `dashboard.widgets[].responsive` (#4876). It survived the sweeps through an
// instrument gap, not on evidence: `page/regions` is an undrilled container,
// so no component-level key has ever been classified (#4956's page-side
// instance). The shape leaves with its last carrier — see
// `RETIRED_DEFS_BY_MAJOR[18]` (`ui/ResponsiveConfig` and its breakpoint maps).
// The live per-breakpoint channel on the same component is `responsiveStyles`
// (ADR-0065).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// Sources are rewritten by the D2 conversion `page-component-responsive-removed`.
export const entry = 'ui/PageComponent:responsive';

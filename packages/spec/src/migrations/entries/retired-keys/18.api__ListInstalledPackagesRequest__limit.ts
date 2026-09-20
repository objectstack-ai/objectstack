// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17667 — ADR-0049 enforce-or-remove (director seat, decision batch #126
// item 1, maintainer 「同意」 2026-09-13, route 2). One capability, both
// halves, never half-deleted: `limit` and `cursor` retire together and share
// one prescription, `PACKAGES_LIST_PAGINATION_REMOVED` in
// `api/package-api.zod.ts`.
//
// `GET /api/v1/packages` declared a window it has never applied. The serving
// door filters on `status` / `type` and returns every remaining row, so a
// caller asking for one row was handed the whole table together with a
// `hasMore: false` that agreed with it — the silent-widening half of the
// ingress rule that names this exact parameter as the one whose drop is worst.
//
// This key is the sharper of the two because it carried `.default(50)`: a
// reader of the published schema — an SDK, codegen, an AI client — was
// entitled to believe an unparameterised list is capped at 50 rows. Nothing
// parses a query string through this schema, so that default has never been
// materialized anywhere, which is why the retirement needs no
// `acceptRetiredDefaultResidue` stage: there is no residue population. The
// `authorable-defaults/api.json` line goes with the key rather than through
// DEFAULT_CHANGES_BY_MAJOR, which excludes retirements by name.
//
// Registered under 18, not 17: v17.0.0 was cut long before this, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the `ui/ListView:pageName`
// precedent). Registered here but NOT in `src/conversions/registry.ts`, and
// that asymmetry is the point rather than an omission: a D2 conversion
// rewrites an authored source or a stored `sys_metadata` row, and this shape
// is HTTP-only — nobody authors a `ListInstalledPackagesRequest` and nothing
// persists one. The prescription reaches consumers as the D3 semantic entry
// `packages-list-pagination-retired` plus this tombstone, the disposition
// `api/ListNotificationsRequest:cursor` (#6361) already took for the same
// shape one route over.
export const entry = 'api/ListInstalledPackagesRequest:limit';

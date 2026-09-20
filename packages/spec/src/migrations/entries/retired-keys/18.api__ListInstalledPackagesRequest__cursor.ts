// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17667 — ADR-0049 enforce-or-remove (director seat, decision batch #126
// item 1, maintainer 「同意」 2026-09-13, route 2). The other half of the
// pagination capability `GET /api/v1/packages` never had; see the sibling
// entry `api/ListInstalledPackagesRequest:limit` for the full record. Two
// keys, one prescription: `PACKAGES_LIST_PAGINATION_REMOVED` in
// `api/package-api.zod.ts` is the single string both rejection sites raise.
//
// `cursor` was the more inert of the two and the less forgiving to keep. No
// emit site has ever written the response half's `nextCursor`, so a caller
// looping "until the cursor runs out" would have re-read the first and only
// page forever, with no error and no 400 — and there is no ordering key on
// this collection a resume could have been built from, so the key had nothing
// to carry even if something had read it.
//
// Same registration shape as its sibling: major 18 (the removal ships on the
// 17.x line; the prescription lives at the major boundary), no D2 conversion
// because the shape is HTTP-only, and the D3 semantic entry
// `packages-list-pagination-retired` carries the prescription to
// `spec-changes.json`, the generated upgrade guide and `os migrate meta`.
export const entry = 'api/ListInstalledPackagesRequest:cursor';

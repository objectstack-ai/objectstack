// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20637 — ADR-0049 enforce-or-remove (maintainer ruling, letter C: retire
// whole, no cache built). `Cube.refreshKey` — the refresh cadence `every` and
// the data-change probe `sql` — was read by nothing, and no analytics result
// is cached for it to key on. Measured: `git grep refreshKey` over the non-test
// sources of `packages/services`, `packages/drivers` and `packages/rest`
// answered 0 lines (4 for the neighbouring `.public` in the same pathspec).
//
// `retiredKey()` on a `strictObject`, for the prescription and the `tsc`
// channel (the `data/Metric:name` precedent). One row, not three: the nested
// `every` and `sql` left with the block, and a dotted row under a tombstoned
// parent names a path this build no longer emits (check (b3)). The D2
// conversion `cube-refresh-key-removed` strips the block wherever the chain is
// replayed; the D3 record is `cube-refresh-key-retired`.
export const entry = 'data/Cube:refreshKey';

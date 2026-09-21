// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19365 — ADR-0049 enforce-or-remove (director seat, decision batch #204
// item 2, maintainer 「204 同意」 2026-09-21, letter C for this door). The
// prescription is `RUNS_LIST_CURSOR_REMOVED` in `api/automation-api.zod.ts`.
//
// ⭐ `cursor` retires ALONE here, and the asymmetry with the sibling
// `/packages` retirement is the whole point of the ruling. On that door both
// `limit` and `cursor` were decorative, so both went (#17667,
// `api/ListInstalledPackagesRequest:limit` / `:cursor`). On THIS door `limit`
// is read end to end — boundary bounds check, service option, then the run
// store's history window — and the Console's flow-runs page sends it today, so
// retiring it would have been a regression rather than a narrowing. The card's
// own body called it "declared, never read"; that sentence is false and was
// measured false before this entry was written.
//
// What made `cursor` retirable is the response half: no emit site has ever
// written `nextCursor`, and this collection has no ordering key a resume could
// have been built from, so nothing could ever have minted a value for a caller
// to send back. A caller looping "until the cursor runs out" re-read the first
// and only window forever.
//
// Same registration shape as the `/packages` pair: major 18 (the removal ships
// on the 17.x line as a minor; the prescription lives at the major boundary
// where `migrate meta` users look), and NO D2 conversion, because a conversion
// rewrites an authored source or a stored `sys_metadata` row and this shape is
// HTTP-only — nobody authors a `ListRunsRequest` and nothing persists one. The
// D3 semantic entry `automation-runs-cursor-retired` carries the record to
// `spec-changes.json`, the generated upgrade guide and `os migrate meta`.
export const entry = 'api/ListRunsRequest:cursor';

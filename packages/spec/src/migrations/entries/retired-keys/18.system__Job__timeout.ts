// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14478 — maintainer ruling 2026-09-02 (recorded on the card as "ruled B"):
// a duration-shaped `z.number()` key carries its unit in its NAME, never only
// in its `.describe()` prose, and no existing offender is grandfathered.
// `job.timeout` said "in milliseconds" in prose while its sibling
// `retryPolicy.backoffMs` spelled its unit — one surface, two conventions, and
// a seconds value copied in became a limit 1000× too short with no error.
// Renamed to `timeoutMs`; the value is unchanged. Tombstoned with
// `retiredKey()` on the strict `JobSchema` (the `ObjectGridProps:defaultSort`
// route — the baseline line carries `[RETIRED]`, and the tombstone carries the
// rename where a bare unknown-key error would only carry the key); sources
// are rewritten by the D2 conversion `job-timeout-to-timeout-ms`, retired from
// the load path (no alias window). Registered under 18, not 17: v17.0.0 was
// cut before this landed, so the rename ships on the 17.x line
// (launch-window convention) and the prescription lives at the major boundary
// where `migrate meta` users look.
export const entry = 'system/Job:timeout';

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14478 — maintainer ruling 2026-09-02 ("ruled B"): the unit of a
// duration-shaped `z.number()` key lives in the key name, and no existing
// offender is grandfathered. `DriverOptions.timeout` said "Timeout in ms" in
// prose and nothing else; renamed to `timeoutMs`, value unchanged. Tombstoned
// with `retiredKey()` because `DriverOptionsSchema` is not `.strict()` (a bare
// deletion would strip the old key in silence). No D2 conversion: a
// `DriverOptions` object is a per-call options argument to driver methods,
// never a stack collection member or a stored row, so the chain has no seam
// (the `kernel/Manifest:loading` precedent); the semantic entry
// `driver-options-timeout-to-timeout-ms` carries the prescription. Registered
// under 18 for the launch-window reason its neighbours state.
export const entry = 'data/DriverOptions:timeout';

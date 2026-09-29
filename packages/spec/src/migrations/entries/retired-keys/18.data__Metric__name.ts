// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20300 — ADR-0049 enforce-or-remove (triage verdict RETIRE by the
// maintainer's criterion for declared-but-unenforced families: Cube.dev and
// LookML key a member by its declared name, with no second inner name that can
// disagree). `Metric.name` was REQUIRED and read by nothing: `measures` is a
// record, and every consumer resolves a metric by its KEY — `getMeta`
// publishes `<cube>.<key>`, `NativeSQLStrategy#lookupMember` and the in-memory
// driver index the bag by key. Measured with a lit control: zero reads of a
// member's inner `name` in non-test source, four reads of the neighbouring
// `measure.label` / `dimension.label` in the same `getMeta` projections.
//
// `retiredKey()` on a `strictObject`, for the prescription and the `tsc`
// channel (the `ui/Action:aria` precedent). Registered under 18, not 17: the
// tombstone ships on the 17.x line (launch-window convention — accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look. The D2 conversion
// `cube-member-inner-name-removed` strips the key wherever the chain is
// replayed; it is owed because the key was REQUIRED, so every stored or built
// cube carries it. The D3 record is `cube-member-inner-name-retired`.
export const entry = 'data/Metric:name';

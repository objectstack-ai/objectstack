// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25792 item 6 — ADR-0141 D8 item 3, ADR-0049 enforce-or-remove.
// `AppManifest.dependencies` listed bare ids with no range, and no install path
// consulted it; the ADR-0141 D2 pre-install check judges the manifest record
// `ManifestSchema.dependencies` alone. D8 offered two fates, a projection from
// the record or a retirement, "decided with a measured reader count". Measured
// at `origin/main` `6390fe52ce`: no reader of the key, and no parse of
// `AppManifestSchema` at all, outside `packages/spec`; none in HotCRM at
// `9464673`. Zero readers leave a projection nobody would read, so it retires.
//
// `retiredKey()` for the prescription and the `tsc` channel. The key was
// DEFAULTED (`[]`); the `acceptRetiredDefaultResidue` stage is NOT adopted,
// because nothing parses the schema to emit the default. No D2 conversion: an
// app manifest is not a stack collection member (the
// `kernel/Manifest:capabilities` precedent). The D3 record is
// `dependency-unread-spellings-retired`.
export const entry = 'system/AppManifest:dependencies';

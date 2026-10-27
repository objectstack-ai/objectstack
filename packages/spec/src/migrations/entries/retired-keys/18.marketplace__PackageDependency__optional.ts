// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25792 item 6 — ADR-0141 D8 item 2, ADR-0049 enforce-or-remove.
// `PackageDependency.optional` ("missing dep is a warning, not an error") had
// no record spelling: the authored dependency is `ManifestSchema.dependencies`
// (`{ [packageId]: versionRange }`), the ADR-0141 D2 pre-install check reads it
// alone and treats every entry as required, and the marketplace snapshot's
// array is a projection of that record. Measured at `origin/main` `6390fe52ce`:
// no reader and no writer of the key outside `packages/spec`, and none in
// HotCRM at `9464673`.
//
// `retiredKey()` for the prescription and the `tsc` channel. The key was
// DEFAULTED (`false`); the `acceptRetiredDefaultResidue` stage is NOT adopted,
// because nothing in either repository parses the snapshot schema to emit the
// default. No D2 conversion: a snapshot is not a stack collection member (the
// `kernel/Manifest:capabilities` precedent). The D3 record is
// `dependency-unread-spellings-retired`.
export const entry = 'marketplace/PackageDependency:optional';

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15932 — ADR-0049 enforce-or-remove (director seat, decision batch #65,
// 2026-09-07, maintainer verbatim 「同意」). `PluginSecurityManifest.scanResults`
// published an array of `KernelSecurityScanResult` on the authorable surface with
// zero authors and zero parsers: no `.parse`/`.safeParse` site existed anywhere
// against the scan-result schemas, so a publisher could declare a clean scan on a
// plugin manifest, be accepted, and get nothing — the declared-not-enforced shape
// Prime Directive #10 names, one layer out from the runtime scanner #14919
// removed for the same reason.
//
// Tombstoned with `retiredKey()`, not deleted: `PluginSecurityManifestSchema` is a
// plain `z.object`, not `.strict()`, so a bare deletion would strip an authored
// key in silence (ADR-0104) — swapping an inert declaration for an invisible one.
// The value type leaves this build entirely (`RETIRED_DEFS_BY_MAJOR[18]`,
// `kernel/KernelSecurityScanResult`).
//
// No D2 conversion: a security manifest is a package artifact a publisher ships,
// never a stack collection member and never a stored `sys_metadata` row, so the
// chain has no seam that would see one — the disposition the sibling
// `vulnerabilityDisclosure.responseTime` entry on this same schema already
// records. The prescription an author meets is the tombstone itself; the ledger
// channel is `plugin-security-scan-result-surface-retired`.
export const entry = 'kernel/PluginSecurityManifest:scanResults';

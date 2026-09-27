// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15932 — ADR-0049 enforce-or-remove (director seat, decision batch #65,
// 2026-09-07, maintainer verbatim 「同意」). `KernelSecurityScanResult` declared a
// complete scan report — timestamp, scanner name/version, a passed/failed/warning
// status, vulnerability and code-issue lists, dependency findings, license
// compliance and a six-number summary — and no layer ever emitted, stored, parsed
// or read one. Its only importer of any kind was `PluginSecurityScanner`, a
// type-only import from `packages/core/src/security/security-scanner.ts`, and
// PR #15930 deleted that file (it closed issue 14919, a number since deleted
// from the board and no longer resolving); the census after it landed put every remaining
// reference inside the declaring module itself, against a lit control (five hits
// for `PluginSecurityManifest` in the same file), so the zero is a reading.
//
// Whole-def retirement, not a tombstone: nothing parses this def, so there is no
// author to hand a prescription to and no `${defKey}:${name}` key leaving a live
// shape. `RETIRED_DEFS_BY_MAJOR[18]` plus the semantic entry
// `plugin-security-scan-result-surface-retired` ARE the declaration — the
// #11825 shape (its sibling in the pair this tree usually cites, issue 8715, is
// a number deleted from the board; 11825 is the half that still resolves).
// The two authorable carriers that pointed here,
// `PluginSecurityManifest.scanResults` and `.vulnerabilities`, are separately
// tombstoned and registered in `RETIRED_KEYS_BY_MAJOR[18]`.
//
// No D2 conversion: a plugin security manifest is a package artifact a publisher
// ships, never a stack collection member and never a stored `sys_metadata` row,
// so the conversion chain has no seam that would see one (the sibling
// `kernel/PluginSecurityManifest:vulnerabilityDisclosure.responseTime` entry
// records the same reasoning for the same schema).
export const entry = 'kernel/KernelSecurityScanResult';

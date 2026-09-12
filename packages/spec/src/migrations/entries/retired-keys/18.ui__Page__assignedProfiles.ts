// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0090 D2 (no Profile concept) + ADR-0049 enforce-or-remove; maintainer
// ruling 2026-09-12, decision batch #121 item 2, verbatim 「同意」.
// `Page.assignedProfiles` was an authorable key named for the concept ADR-0090 D2
// deleted, and it gated nothing: measured across this repository and objectui,
// every hit was a declaration, a generated artifact, prose or a round-trip test —
// no renderer, route or metadata read door ever read it, so a page that "assigned
// profiles" stayed open to every caller who could reach it. `PageSchema` is a
// `strictObject`, so the key is deleted from the shape and the prescription lives
// in that schema's `guidance` table; the two alias entries that steered an
// authored `profiles:` / `assignedTo:` INTO this retired vocabulary became
// refusals naming the permission-set route in the same change. Page audience is
// the permission set's: the object's permission sets gate the DATA, and positions
// bind those sets to people. D2: `page-assigned-profiles-removed`; D3 semantic:
// `page-assigned-profiles-audience-to-permission-set`.
export const entry = 'ui/Page:assignedProfiles';

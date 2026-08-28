// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12497 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-26, decision-
// inbox batch 5, accepting #1883's recommendation B). `allowPurge` claimed to
// gate a `purge` (hard-delete / GDPR erase) ObjectQL operation that has never
// existed: no destructive lifecycle verb is in the engine's dispatch
// vocabulary (pinned by objectql's
// `engine-middleware-operation-vocabulary.test.ts`, #8106). This was ADR-0049's
// worst false-compliance shape — an admin who set `allowPurge: false` believed
// a lock on permanent deletion existed, when the operation itself did not.
// The permission evaluator's pre-mapping row (`OPERATION_TO_PERMISSION`
// purge→allowPurge) retired in the same batch: with the bit unwritable, a
// mapping onto it was a claim about a surface that rejects authoring. A
// dispatched `purge` stays denied fail-closed via the evaluator's
// `DESTRUCTIVE_OPERATIONS` backstop — there is no ungated window in either
// direction. THE KEY RETURNS with the M2 lifecycle initiative (feature + RBAC
// in one batch, maintainer 2026-08-03); anchor card #1883 stays open.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// ObjectPermissionSchema is `strictObject` but the def is reachable from the
// `permission` metadata root, so the route is the `retiredKey()` tombstone
// (the `rls.priority` posture) — the key stays in the walked shape as
// `[RETIRED]`, and authoring it is a tsc error and a parse error carrying the
// prescription — with ONE ruled exception (#12840, maintainer 2026-08-28):
// the key's own retired default (`false`), which the published 17.x toolchain
// materialized into every built artifact's entries, parses as inert residue
// and is stripped by the `acceptRetiredDefaultResidue` stage ahead of the
// shape; every other value keeps this refusal. Sources are rewritten by the
// D2 conversion `permission-allow-restore-purge-removed`, which strips the
// key from every object grant in `permissions[].objects`.
export const entry = 'security/ObjectPermission:allowPurge';

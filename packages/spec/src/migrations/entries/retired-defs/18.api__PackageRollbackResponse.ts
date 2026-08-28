// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12038 — `api/package-api.zod.ts` `PackageRollbackResponseSchema`, retired
// whole together with the `PackageApiContracts.rollbackPackage` entry that
// bound it (maintainer ruling 2026-08-27, sub-question 3A). The schema
// declared a VERSION rollback — `{ success, restoredVersion?, message? }` —
// while the live `POST /api/v1/packages/:packageId/rollback` route posts
// `{ commitId }` and the dispatcher serves it with `rollbackToPackageCommit`,
// the ADR-0067 COMMIT rollback: a wrong-operation declaration bound to the
// exact live path, which a future sweep would have read as authoritative.
// Zero consumers measured across objectstack/objectui/cloud (#12038 survey
// §5.2): only its own unit test and the #11925 negative guard, both updated
// in the retiring PR. No carrier key, no authored document, so no tombstone
// and no D2 conversion — this table plus the D3 semantic entry
// `package-rollback-response-retired` ARE the declaration (the #8715 route-3
// shape). The live route's true contract is
// `RollbackToPackageCommitResponseSchema` (`api/package-lifecycle.zod.ts`),
// authored in the same PR AFTER this retirement per the ruling's sequencing.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 / #8715 precedent).
export const entry = 'api/PackageRollbackResponse';

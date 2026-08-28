// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'package-rollback-response-retired',
  surface:
    'api.packageRollbackResponse (`PackageRollbackResponseSchema` in '
    + 'api/package-api.zod.ts — 1 def, 3 exported names: '
    + '`PackageRollbackResponseSchema`, `PackageRollbackResponse`, '
    + '`PackageRollbackResponseParsed` — plus the `PackageApiContracts.'
    + 'rollbackPackage` contract-map entry that bound it to '
    + '`POST /api/v1/packages/:packageId/rollback`)',
  replacement:
    '`RollbackToPackageCommitResponseSchema` (api/package-lifecycle.zod.ts) — '
    + 'the transcription of what the live route actually answers: the '
    + 'dispatcher routes `POST /packages/:id/rollback` (body `{ commitId }`) '
    + 'to `rollbackToPackageCommit`, the ADR-0067 COMMIT rollback, whose '
    + 'declared return is `{ success, revertedCommits: string[], '
    + 'failed: Array<{ commitId, error }> }`. Consumers of the retired type '
    + 'were reading a VERSION-rollback shape (`restoredVersion`) the route has '
    + 'never answered; read `revertedCommits`/`failed` instead. '
    + '`PackageRollbackRequestSchema` stays published (ruled out of the '
    + 'retirement), bound to no route.',
  reason:
    'Maintainer ruling 2026-08-27 on #12038, sub-question 3A (五问一批, '
    + '「其他接受」). The schema declared a version rollback — '
    + '`{ success, restoredVersion?, message? }`, matching its file header '
    + '"Rollback a package" — while the live path it was contract-bound to '
    + 'serves the ADR-0067 commit rollback: a different operation with a '
    + 'different result. Binding it in the SDK would compile and be false '
    + '(#11925 left a compile-time guard against exactly that substitution). '
    + 'Zero consumers measured across objectstack, objectui and cloud '
    + '(#12038 survey §5.2, re-verified at the retiring PR\'s base): only its '
    + 'own unit test and the #11925 negative guard. A published declaration '
    + 'that outran the implementation is the #3877 hazard realised in the '
    + 'opposite direction — not "no declaration" but a WRONG one — and it is '
    + 'retired BEFORE the true schema is authored so no window exists in '
    + 'which both claims are published.',
  acceptanceCriteria:
    'No code imports `PackageRollbackResponseSchema`, '
    + '`PackageRollbackResponse` or `PackageRollbackResponseParsed` from '
    + '`@objectstack/spec` or `@objectstack/spec/api` — every one is TS2305 '
    + 'after upgrade (pinned by runtime namespace probes in '
    + 'api/package-api.test.ts). `PackageApiContracts` carries no entry whose '
    + 'path is `/api/v1/packages/:packageId/rollback` (same pin). No metadata '
    + 'document needs editing: the schema was reachable from no metadata-type '
    + 'binding, stack collection or /meta door. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED: nothing ever registered routes or generated '
    + 'SDKs from the contract entry, and the route\'s handler emits the same '
    + 'bytes before and after — the retirement removes a false claim, not '
    + 'behaviour.',
};

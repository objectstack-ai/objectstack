// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'standard-error-code-batch-members-retired',
  surface:
    '`error.code` values `BATCH_PARTIAL_FAILURE`, `BATCH_COMPLETE_FAILURE` and '
    + '`TRANSACTION_FAILED` — three `StandardErrorCode` members retired from the closed '
    + 'catalog (ADR-0112 amendment 2026-08-18), so constructing or parsing an ApiError '
    + 'with any of them now refuses at the vocabulary boundary',
  replacement:
    'branch on the codes the batch surface actually speaks: a rolled-back atomic batch '
    + 'marks each row `errors[0].code = ROLLED_BACK`, rows the abort never reached '
    + '`NOT_ATTEMPTED`, and the causal row keeps its own error — all per row, at HTTP '
    + '200, both codes ledger-registered. Delete any branch on the three retired '
    + 'spellings outright: it never fired, because nothing ever emitted them',
  reason:
    'ADR-0049 enforce-or-remove applied to the error vocabulary. No producer has ever '
    + 'emitted any of the three — measured on #9266: outside the enum declaration the '
    + 'only occurrences in the whole repo were two spec tests using them as arbitrary '
    + 'fixture strings, and `git log -S` shows they never had a producer since ADR-0112 '
    + 'introduced the vocabulary. A catalog member no producer can speak teaches an AI '
    + 'author a branch that can never fire; after removal the wrong spelling fails '
    + 'parse at authoring time instead. This is a WIRE vocabulary, not stored metadata '
    + '— no `sys_metadata` row exists for the D2 chain to rewrite, so (like '
    + '`driver-sql-upsert-cross-row-identity-merge-refused`) this entry is the '
    + 'notification channel. No mechanical rewrite exists: a dead branch has no '
    + 'correct mechanical target — the per-row codes carry strictly more information '
    + 'than the envelope code the branch expected. Maintainer ruling 2026-08-18: '
    + '「9266 同意 A」. #9266, ADR-0112, ADR-0049.',
  acceptanceCriteria:
    'No consumer branches on the three retired spellings; batch failure handling reads '
    + 'the per-row `results[].errors[].code` (`ROLLED_BACK` / `NOT_ATTEMPTED`) instead '
    + 'of an envelope-level code; constructing an ApiError with a retired spelling '
    + 'fails `StandardErrorCode`/`ApiErrorSchema` parse rather than passing silently.',
};

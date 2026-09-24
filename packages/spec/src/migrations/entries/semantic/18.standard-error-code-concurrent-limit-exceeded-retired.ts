// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'standard-error-code-concurrent-limit-exceeded-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'error.code value CONCURRENT_LIMIT_EXCEEDED — a StandardErrorCode member retired from the '
    + 'closed catalogue, so constructing or parsing an error with it now refuses at every catalogue '
    + 'door (StandardErrorCode, ErrorCode / ApiErrorSchema.code, makeApiErrorSchema) with the '
    + 'removal prescription',
  replacement:
    'delete any branch on `CONCURRENT_LIMIT_EXCEEDED` — a branch on a catalogue code no producer '
    + 'emits has nothing to match. For request pacing branch on `RATE_LIMIT_EXCEEDED` '
    + '(HTTP 429; wait `retryAfterSeconds` before retrying). A service that enforces its own '
    + 'concurrency limit registers a code for it in its own error-code ledger rather than reusing '
    + 'the retired spelling. `QUOTA_EXCEEDED`, its catalogue neighbour, is unchanged.',
  reason:
    'ADR-0049 enforce-or-remove applied to the ADR-0112 error catalogue. Ruling A on #17707 '
    + '(maintainer 「同意」, decision batch #126 item 2) retired both producerless 429 members; the '
    + 'closure-review ruling of 2026-09-24 (letter 留·收窄, maintainer 「其他同意」) narrowed it to '
    + 'this code alone after `QUOTA_EXCEEDED` was found emitted by a hosted AI agent route and read '
    + 'by the console chatbot plugin. The ledger doctrine in error-code-ledger.zod.ts names a '
    + 'producerless row with no card behind it as the registered-but-unemittable retirement class, '
    + 'and a catalogue member no producer speaks teaches an author a branch that cannot fire; after '
    + 'removal the stale spelling fails parse with its prescription instead. An error code is WIRE '
    + 'vocabulary, not a metadata key, so there is no authored source for a D2 conversion to '
    + 'rewrite and this entry is the notification channel, as it was for '
    + '`standard-error-code-batch-members-retired`. No mechanical rewrite exists: a dead branch has '
    + 'no correct mechanical target.',
  acceptanceCriteria:
    'No consumer branches on `CONCURRENT_LIMIT_EXCEEDED`; request pacing is handled on '
    + '`RATE_LIMIT_EXCEEDED`. Constructing or parsing an error with the retired spelling fails '
    + '`StandardErrorCode`, `ErrorCode` / `ApiErrorSchema` and the `makeApiErrorSchema` envelope '
    + 'parse, and the failure message is the removal prescription rather than the bare enum listing. '
    + '`QUOTA_EXCEEDED` still parses at every door.',
};

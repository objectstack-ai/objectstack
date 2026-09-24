---
'@objectstack/spec': minor
---

**BREAKING** — `CONCURRENT_LIMIT_EXCEEDED` is removed from the closed `StandardErrorCode` catalogue (#17707).

A `major`-class change, recorded as `minor` under the launch-window convention. ADR-0049 enforce-or-remove applied to the ADR-0112 error catalogue: ruling A on #17707, narrowed on 2026-09-24 to this code alone.

**Why.** A catalogue member is the list callers branch on exhaustively, and a member with no producer teaches a branch that cannot fire. `CONCURRENT_LIMIT_EXCEEDED` had no producer behind it when the ruling was recorded, so it leaves the catalogue. Its neighbour `QUOTA_EXCEEDED` stays, unchanged, as the narrowing ruled.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `CONCURRENT_LIMIT_EXCEEDED` (`StandardErrorCode`, 429) | nothing — delete the branch. For request pacing branch on `RATE_LIMIT_EXCEEDED` (HTTP 429; wait `retryAfterSeconds` before retrying). A service that enforces its own concurrency limit registers a code for it in its own error-code ledger. |

**The one-line fix: delete every branch on `CONCURRENT_LIMIT_EXCEEDED`.** A comparison against a value typed `StandardErrorCode` or `ErrorCode` no longer compiles (`TS2367`). At runtime the spelling now fails `StandardErrorCode`, `ErrorCode` / `ApiErrorSchema.code` and `makeApiErrorSchema(...)` parse, and the failure message is the removal prescription itself.

**What stays.** The other `StandardErrorCode` members, `QUOTA_EXCEEDED` included, are unchanged.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** Inside this repository the code occurred only in the enum declaration, the hand-written error catalogue page, the generated reference pages and the unpinned-status baseline, and the pinned objectui checkout does not name it; `@objectstack/spec` is published, so readers elsewhere were not measured.

The ADR-0087 D3 semantic entry `standard-error-code-concurrent-limit-exceeded-retired` carries the judgement: an error code is wire vocabulary, not a metadata key, so there is no authored source for a D2 conversion to rewrite.

Clause-②: no

<!-- adr-0087: registered standard-error-code-concurrent-limit-exceeded-retired -->

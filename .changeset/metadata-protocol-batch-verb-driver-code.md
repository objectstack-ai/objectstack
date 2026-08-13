---
'@objectstack/metadata-protocol': patch
---

Stop putting a raw driver `code` on the batch verbs' `failed[]` (#8441).

#8333 closed the `error` **string** on these payloads and deliberately left the
sibling `code` limb alone — a different field with a different rule. Measured
afterwards, on the fixed branch, `publishPackageDrafts` still answered
`{ error: 'publish failed', code: 'SQLITE_ERROR' }`: the sentence withheld and
the driver's own dialect still shipping beside it. `revertCommit` measured the
same. Both ride response DATA, so no HTTP boundary's withhold reaches them, and
`code` is a field clients branch on.

`code` writes `ApiErrorSchema.code`, a **closed union** (ADR-0112 D4), so the
rule here is catalog membership — `StandardErrorCode ∪ ERROR_CODE_LEDGER`, the
same predicate `carryCatalogedErrorCode` and `toRowApiError` already apply —
and **not** the 4xx question #8333 asks of the message. A catalogued code now
passes through byte for byte; an uncatalogued one is replaced by the code its
declared status maps to, or `INTERNAL_ERROR` when it declared none. No new error
code was minted, and an error carrying no code still produces no `code` key.

Nothing a caller branches on is lost: `BATCH_ABORTED` on the collateral rows,
the repository's `VERSION_NOT_FOUND` / `NOT_OVERRIDABLE` / `ITEM_LOCKED`, and a
ledger-registered engine code such as `ERR_DATASOURCE_UNAVAILABLE` all survive —
the last one on a 503 whose sentence is withheld, which is exactly the case that
shows the two limbs answer different questions about the same error. The Studio
publish surface still highlights the offending field of a rejected draft from
`INVALID_METADATA` plus its structured `issues`.

`discardPackageDrafts` and `deletePackage` build the same limb and needed no
filter: both wrap `deleteMetaItem`, whose re-wrap exits already gate `code`
through the catalog, so no driver dialect survives to them. That is measured and
pinned rather than assumed.

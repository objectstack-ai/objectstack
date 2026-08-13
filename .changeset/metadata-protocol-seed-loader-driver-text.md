---
'@objectstack/metadata-protocol': patch
---

Stop putting raw driver text on the seed loader's `errors[].message` (#8442).

#8333 closed the `error` **string** on `applySeedBodies`, but the same response
object carries a second channel the seed loader fills itself. Measured on
current `main`, a `sys_metadata` outage under a seed write still answered
`"Failed to write acct record #0 (name=acme): SQLITE_ERROR: no such table:
sys_metadata"` — and `seedApplied` rides a **200** publish response, so no HTTP
boundary's message withhold reaches it.

`errors[].message` is free text, so #8441's catalog-membership rule (which
governs `code`, a closed union) does not apply: this is #8333's question — did
the producer AUTHOR this sentence for a caller? But #8333's **answer**, a
numeric 4xx `status`, is insufficient at this producer, because this sink
receives a population `protocol.ts`'s collectors never see: the data engine's
**validation layer**. An `@objectstack/objectql` `ValidationError` carries
`code: 'VALIDATION_FAILED'` and deliberately **no** `status` — deciding it means
400 is "the job of whichever boundary serves it", and for the seed channel this
loader is that boundary. So a caught sentence is quoted when the error declared
itself a client refusal by **either** shape: a 4xx `status`, or the
`VALIDATION_FAILED` shape that `@objectstack/types`' `validationFailureDetails`
already recognises (imported, not re-spelled). Everything else is replaced by a
stable line and goes to the log instead.

That distinction is the whole fix rather than a nuance. On this producer the
structured keys do **not** carry the offending field: `field` is the literal
`'(write)'` and `targetField`/`attemptedValue` name the record's external key,
so "which key was rejected and why" exists only inside the validation sentence.
Applying the 4xx test alone would have blanked exactly the per-record authoring
feedback `errors[]` exists for — trading an authoring surface for a disclosure,
the trade #8441 refused.

Nothing an author needs is lost. Every structured key is untouched (they are
built from the seed declaration and the record, never from the caught error),
the authored prefix is unchanged byte for byte, and a real malformed seed record
still reports which record and which key — pinned through the **real** ObjectQL
validator, not a hand-built error. The withheld driver line still reaches
`logger.error`, marked as withheld from the response, so the operator half of
the diagnostic is intact.

Both payload producers are covered: the pass-1 record write and the pass-2
deferred-reference back-fill. The loader's authored messages (unresolved
references, dropped references, dynamic-value failures) never quoted a driver
and are unchanged.

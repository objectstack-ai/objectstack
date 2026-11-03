---
'@objectstack/spec': patch
---

feat(spec): `ExplainAccessRequest` declares `recordIds`, the batch selector the explain wire schema already carries

Clause-②: yes (widening)
Metadata-protocol: none

The `security` service contract's `explain(request)` selector, `ExplainAccessRequest`, now declares the optional `recordIds` member. The wire schema `ExplainRequestSchema` already declared it, and both the REST explain route and the reference security service already honour it. A TypeScript caller handing `explain` a batch no longer needs a cast to get past the contract type.

- **The type is the wire schema's own.** `recordIds` is typed as `ExplainRequest['recordIds']` (a list of ids), so the contract and the schema cannot drift; a type-level test holds the two equal.
- **What it means.** The same record-grained question as `recordId`, for several records of one `(object, operation)` pair: mutually exclusive with `recordId`, at least one and at most `EXPLAIN_BATCH_MAX_RECORD_IDS` ids, answered by `ExplainDecision.records` in the same order.
- **Nothing is required of an implementation.** A security service may ignore `recordIds` and answer only the object-level decision, with no `records`; the REST explain route then asks each id singularly, as it already does.
- **No runtime change.** Only the declared type moves. Every request that compiled before still compiles.

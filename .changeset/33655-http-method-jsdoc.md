---
'@objectstack/spec': patch
---

docs(spec): the `HttpConfigSchema.method` TSDoc says how a durable `http` node's verb is resolved, without quoting removed code

Clause-②: no
Metadata-protocol: none

The TSDoc on `method` in `io-node-config.zod.ts` quoted two `??` spellings the `http` node executor no longer has. It now says that a durable node with no `method` sends `POST`, whether through the messaging HTTP outbox or on the no-outbox fallback, and that the executor resolves the verb once from the authored `method` and `durable`. The schema itself is unchanged.

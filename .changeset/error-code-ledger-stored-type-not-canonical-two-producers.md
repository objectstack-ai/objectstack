---
"@objectstack/spec": patch
---

docs(spec): `STORED_TYPE_NOT_CANONICAL` ledger comment names both producers and their atomicity (#9361)

The ledger entry at `error-code-ledger.zod.ts:381` described `STORED_TYPE_NOT_CANONICAL`'s
only producer as the publish pre-flight ("refused at the publish pre-flight, batch-atomic").
PR #9360 (#9174) added a second producer — `revertCommit`'s restore limb, which refuses
per-item on its existing `failed[]` channel and is explicitly NOT batch-atomic — leaving the
comment naming one of two producers, with the wrong atomicity for the one it omitted.

The comment now names both: the publish pre-flight (batch-atomic, `#8908`) and
`revertCommit`'s restore limb (per-item on `failed[]`, NOT batch-atomic, `#9174`).

Text-only change — accept/reject behavior, the error code, and its envelope are all
unchanged.

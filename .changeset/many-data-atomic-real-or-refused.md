---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): `deleteMany` / `updateMany` honour `atomic` for real, or refuse it (#4620)

ADR-0119 D4 made `batchData`'s `atomic` flag a real guarantee. Its two siblings
in the same file were out of that PR's confirmed scope and kept the defect:

- **`deleteManyData` was fake-atomic.** `atomic: true` opened no transaction; it
  only `break`-ed the loop, so every row deleted before the failure stayed
  **deleted** while the response called itself atomic and reported those rows
  `success: true`. Worse than the `batchData` case it was copied from, because a
  partial delete has no natural undo — a client cannot reconstruct the rows from
  its own request.
- **`updateManyData` ignored `atomic` entirely.** The option was accepted,
  declared in `BatchOptionsSchema` with an all-or-nothing contract, and never
  read: a caller asking for atomicity silently got best-effort, with no signal.

Both now run the **same** atomic arm as `batchData`, extracted into one shared
runner so a fourth copy of transaction handling cannot drift into a fourth lie:

- `atomic: true` runs the whole batch inside ONE `engine.transaction()`; the
  first failure rolls back every prior write.
- A rolled-back batch reports **zero successes**. Rows that had succeeded are
  marked `ROLLED_BACK: record <i> failed — <cause>`, rows never reached are
  `NOT_ATTEMPTED: atomic batch aborted by record <i>`, and the causal row keeps
  its own error — so a client can tell "attempted, undone" from "never ran".
- `atomic` outranks `continueOnError`, whose contract text already scoped it to
  `atomic=false`.

**Behaviour change to be aware of:** a runtime that cannot roll back (no
`engine.transaction()`, or a default driver without `beginTransaction`) now
**refuses** an `atomic: true` `deleteMany` / `updateMany` with `501
NOT_IMPLEMENTED` instead of silently running best-effort — the same fail-closed
gate `batchData` uses. That silent downgrade is the defect class this fixes; if
you want best-effort, ask for it (`atomic: false`, or omit the option), or probe
the runtime's transaction support before sending. Non-atomic behaviour of both
endpoints — including the `continueOnError` interaction and their response
shapes — is unchanged.

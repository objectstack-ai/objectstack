---
"@objectstack/spec": patch
---

Liveness ledger: `ActionSchema.operation` and `ActionSchema.patch` re-graded `planned` → `live`, and their author warning dropped.

Both keys were seeded `planned` with an `authorWarn` whose hint said, in as many words, that "nothing performs the write yet". That premise is gone: the runtime half of the declarative row-level field write is merged, so the ledger now says what the tree does.

- **`operation` → `live`.** It is the executor's own discriminator (`isDeclarativeUpdateAction`, a bare read of the declared key) and it is consulted *before* `type` at every reader: the REST `/actions` door, the MCP `run_action` door, the headless-invokability predicate, the type-error prescription, and the MCP listing summary.
- **`patch` → `live`.** `declarativeUpdateWrite` reads it as the base of the write bag `{ ...patch, ...params }` — the static values sit *under* the ones the dialog collected — and `executeDeclarativeUpdateAction` hands that bag to a single data-plane update of the routed row, under the caller's own execution context.

Judged separately and both measured, not inferred: deleting the `operation` read fails 24 of the executor's 27 pins, deleting the `patch` read fails 16 of them, and the unmutated tree passes all 27.

**What moves for consumers.** `@objectstack/spec` ships `liveness/` in its published files, and `@objectstack/lint` resolves that directory off the installed package to build its author-warning map. Dropping `authorWarn` on these two rows therefore removes a real `os lint` finding: authoring `operation: 'update'` + `patch` no longer draws `liveness-planned-property`. Nothing else moves — no schema, no `.describe()`, no export, no accept-set change.

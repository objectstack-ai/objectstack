---
"@objectstack/objectql": patch
"@objectstack/core": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-auth": patch
---

fix(objectql): a by-id `update()`/`delete()` against a nonexistent record answers 404 `RECORD_NOT_FOUND` instead of a 400 from further down the pipeline (#7867)

Nothing on the action-body write path ever asked whether the target row existed.
`ctx.api.object(name).update({ id, … })` reached `ObjectQL.update()`'s by-id
branch through `buildSandboxApi` → `ObjectRepository`, and that branch had **no
existence gate at all**: `engine.update()` on a ghost id was a silent no-op that
resolved `null`, so the write ran on into validation, the driver and the hook
chain and died on whichever complained first.

**Which one it died on varied with the object's declarations**, which is why the
defect read as several unrelated bugs:

- a **hooked** object → `400` `HookConditionError`, from an `afterUpdate`
  condition reading `previous` on a row nobody read;
- an **unhooked** object → `400` `VALIDATION_FAILED` "X is required", because
  with no prior row a PATCH is validated as if it were a whole record.

The 400 class varied; the missing 404 was the constant. Measured on one showcase
stack, same id, same object, same second: `POST /actions/showcase_task/
showcase_mark_done/<ghost>` answered 400 while `PATCH /data/showcase_task/
<ghost>` answered 404. Both answer **404 `RECORD_NOT_FOUND`** now.

`delete()` had the same shape and was the worse of the two: with no gate it
reported success for a row that was never there, so a typo'd id, an
already-deleted row and a real deletion were indistinguishable.

**This is not a `previous`-binding bug.** `if (priorRecord) hookContext.previous
= …` is correct and is untouched — ADR-0058 Addendum II / #4649 require that an
absent row leave `previous` UNBOUND rather than fabricated. It was behaving
correctly on a path that should never have been entered, so the fix removes the
producer rather than specializing what it produced.

**Where the gate went, and why there.** At the engine, in the by-id branches of
`update()` and `delete()` — the one point all three action-body write faces
funnel through (`ctx.api.object()`, its context-less repo-facade fallback, and
`ctx.engine.update()`). A repository-level gate would have closed one of the
three and made `ql.update(o, { id })` and `ctx.api.object(o).update({ id })`
answer one ghost id two different ways. Two sibling paths already gated
correctly — `protocol.updateData`/`deleteData` (#4435) and `callData`'s ObjectQL
fallback (#5138) — and all three now throw the **same** `recordNotFoundError`,
which moved to `@objectstack/core` so the engine can reach it without importing
`@objectstack/metadata-protocol` (forbidden in the `/core` closure by ADR-0076
D2's boundary ratchet). `@objectstack/metadata-protocol` re-exports it unchanged.

Existence is asked with a pre-write read, never off the write's own result:
`IDataDriver.update` declares no not-found signal, and the engine's post-write
readback is `null` for a second reason (a write that moves the row out of the
caller's row scope), so reading either would answer 404 to a write that landed.

**Behaviour change worth knowing about — the by-id prior-row read is now
unconditional.** #5284 (update) and #5929 (delete) had narrowed it to "does
anything CONSUME the prior row?", skipping the read for objects with no hook, no
prior-reading validation rule and no roll-up. Existence is a consumer that
demand list never enumerated and the one consumer every by-id write has, and no
cheaper question answers it — so the skip and the gate are mutually exclusive.
The measured cost is small: #5929's own record enumerates the global hook
registrants (plugin-sharing, service-storage, plugin-auth, plugin-audit), so on
any kernel that loads them the demand was already true for every object and the
narrowing skipped nothing. The read is genuinely new only for a bare
`@objectstack/objectql/core` embedder — which is buying a 404 it did not have.

Three read-count pins measured the old skip and now measure the read, each
recording what changed and why at its own site: #5284's and #5929's in
`packages/objectql`, and #5860's `sys_job_queue` case in `@objectstack/plugin-audit`.
The DISPATCH half all three are actually about — the per-object `hasHooksFor`
question, the `excludeObjects` subtraction, and the retired
`sys_fetch_previous_*` builtins — is untouched and still pinned.

One further case encoded the old silent no-op as correct: `@objectstack/plugin-auth`'s
#5941 last-admin-guard test deleted a `sys_account` id that was never seeded and
asserted it RESOLVED, to show the guard does not write-guard that object. It now
deletes a REAL row — which states the same thing more strongly — and separately
pins that a ghost id there is refused by the ENGINE rather than by the guard.

**Scope.** By-id only. A `multi: true` predicate write matching zero rows still
resolves "0 rows affected" — the same line both sibling paths draw.

`@objectstack/runtime`: the sandbox error passthrough now also carries `status`
alongside `code` and `fields`, so an error that names its own HTTP status keeps
it across the QuickJS boundary. Without it the action surface answered the right
diagnosis at the wrong status (`{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`);
`domains/actions.ts` already honoured `.status` first — the number simply never
arrived. A permission refusal thrown inside a body likewise keeps its 403 now
instead of flattening to 400.

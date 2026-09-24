---
"@objectstack/plugin-security": minor
"@objectstack/objectql": minor
---

fix(plugin-security, objectql)!: a row-level `check` now holds for every row a multi-row write stores — an array insert and a predicate (`multi: true`) update (#19950, #19964)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement change on the write gate: no authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. The remedy for a newly refused write is to declare `check` on the policy, or to fix the data. -->

**BREAKING**: this narrows the set of writes the write gate accepts. A multi-row write that is admitted today can be refused after this change. It ships as `minor` under the launch-window convention, as the using-defaulted check did (#19942).

A row-level security `check` (declared on the policy, or defaulted from its `using`) is the write-side half of the policy: a row the check refuses is never stored. The write gate enforced it for a single-row insert and a by-id update, but not for the two multi-row write shapes. An **array insert** (`insert(object, [rows])`, which the create-many data route calls) installed no check, so its rows were stored unjudged. A **predicate update** (`update(object, changes, { where, multi: true })`) never judged its new rows. The gate assumed a `using`-scoped `where` covered the write, but a policy that declares only `check` scopes nothing, and a scoped `where` says nothing about the new row in any case.

Both shapes are now judged row by row. An array insert judges each row on the image the `beforeInsert` chain produced. A predicate update judges each row the write selects on its new image: the matched row merged with the final payload. The engine (`@objectstack/objectql`) supplies those rows through the seam the insert check already uses (`OperationContext.postHookWriteImageCheck`). It runs the judgement on the predicate path over the rows its composed query selects, reusing the matched-row read that path already makes.

**Writes that are now refused.** Each refusal is the existing row-level CHECK denial, `403 PERMISSION_DENIED`, and nothing is stored. One failing row refuses the whole write. There is no transition switch.

- **A predicate update under a policy that declares `check`**, when any matched row's new image fails that check, including when the policy has no `using` at all.
- **A predicate update that moves a matched row out of a policy's `using`**, when no applicable policy declares `check`. The `using` is the defaulted check; a by-id update already gives this answer.
- **An array insert** when any row fails the check. This includes every configuration that already refused each single insert, such as a `using` or `check` that does not compile.
- **A predicate update on a host that installs the judgement and never runs it**, for example a custom write executor in place of the engine. It is refused as an insert already is, with an `error` log saying the check was not evaluated.

**Remedy.** To let a write store a row outside a policy's scope, declare a `check` on that policy that admits it; otherwise fix the data the write carries.

**What does not change.**

- A single-row insert is judged exactly as before. A by-id update is not changed by this entry; its judgement on the row it stores is its own entry (#19989).
- A predicate update still touches only the rows its scoped `where` selects. The check refuses a write; it never changes which rows are selected.
- A predicate update or array insert whose rows all pass is admitted as before.
- A system-context write is not gated.

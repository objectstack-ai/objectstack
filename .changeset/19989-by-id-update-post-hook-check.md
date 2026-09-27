---
"@objectstack/plugin-security": minor
"@objectstack/objectql": minor
---

fix(plugin-security, objectql)!: a by-id update's row-level `check` now holds for the row it stores, after the `beforeUpdate` chain (#19989)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement change on the write gate: no authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. The remedy for a newly refused write is to change the hook, the policy's `check`, or the data. -->

**BREAKING**: this narrows the set of writes the write gate accepts. A by-id update that is admitted today can be refused after this change. It ships as `minor` under the launch-window convention, as the multi-row check did (#19950).

A row-level security `check` (declared on the policy, or defaulted from its `using`) is the write-side half of the policy: a row the check refuses is never stored. An insert and a predicate update are judged on the row the driver stores. A by-id update was judged only on the change set as the caller sent it, merged with the stored row, before the `beforeUpdate` chain ran. A value a hook wrote into a checked field after that point was never judged, so the row it produced could be stored outside the policy.

A by-id update is now also judged on the row it stores: the prior row merged with the final payload, after the `beforeUpdate` chain and both readonly strips, before the statement. The engine (`@objectstack/objectql`) runs that judgement through the seam the insert and predicate update already use (`OperationContext.postHookWriteImageCheck`). The existing judgement of the change set as sent stays, so this change only ever refuses more.

**Writes that are now refused.** Each refusal is the existing row-level CHECK denial, `403 PERMISSION_DENIED`, and nothing is stored. There is no transition switch.

- **A by-id update whose `beforeUpdate` chain writes a checked field to a value the check refuses**, including a value derived from a field the caller changed.
- **A by-id update on a host that installs the judgement and never runs it**, for example a custom write executor in place of the engine. It is refused as an insert and a predicate update already are, with an `error` log saying the check was not evaluated.
- **An update whose payload `id` addresses no row while `where.id` addresses one**, under a policy with a `check`. The engine writes the `where.id` row while the gate had judged the payload id. It used to be written and then refused; it is now refused before anything runs.

**Remedy.** A hook that must store a value the caller's `check` refuses does so in a separate write under a system context, or the policy declares a `check` that admits it. Otherwise fix the data the write carries. For the last case, address the row with one id: `update(object, { id, ...fields })` or `update(object, fields, { where: { id } })`.

**What does not change.**

- A by-id update whose hooks leave the checked fields inside the check is admitted as before.
- A change set the check refuses as sent is refused as before, even when a hook would have replaced the refused value.
- Inserts and predicate updates are judged exactly as before.
- A system-context write is not gated.

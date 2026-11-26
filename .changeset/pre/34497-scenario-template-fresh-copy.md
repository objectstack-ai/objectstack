---
'@objectstack/scenarios': patch
---

fix(scenarios): template mode's iterate Run half runs an operation an earlier write would meet on a fresh copy of the iterated app, so a one-way state rule no longer leaves the operations after a transition unmeasured

Clause-②: no
Metadata-protocol: none

Scratch and ask modes already ran such an operation on a fresh seeded copy of the app. Template mode still wrote the moved rows back through the app's own doors, because its app holds the agent's iterate, made live through those doors, which a host booted again from the project would not hold. On a card with a state machine the write-back met the app's rule: in `asset_lifecycle`, approving scrap request DR-0006 (`submitted` → `approved`) was followed by a write-back to `submitted`, refused with 400 `VALIDATION_FAILED`, and every later operation of the half read `restore: … not measured`.

Now template mode's copy is a blank host booted from the same project with the iterated app installed unmanaged, the same way the run's own install landed: the manifest that install sent, with each collection the app serves replaced by the items it serves after the iterate. Each served item comes off its read decorations first (`stripReadDecorations` from `@objectstack/spec/kernel`), because a served body is no valid input to its own schema until they are removed. The unmanaged install door refuses a served flow that still carries `_diagnostics` (422 `INVALID_METADATA`, measured on a blank 18.6.0 host). Measured on that host with the `travel_expense` verified build and an iterate made through `PUT /api/v1/meta/object/…` (one new object with a state-machine rule, one new lookup field): the copy serves the same objects, fields, validation rules and actions as the iterated host. The only difference is the new object's `_packageId` (`sys_metadata` on the host, the install's copy package on the copy). The card's seed loads alike there (757/757 rows, no refusal, every persona's permission set assigned).

The result carries `restored: { freshCopy }` as in the other modes. A copy whose install is refused, that does not boot, or whose seed does not load as the run's did makes the operation NOT MEASURED with that reason. Door mode still writes the rows back.

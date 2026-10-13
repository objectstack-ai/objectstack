---
'@objectstack/verify': minor
'@objectstack/cli': minor
---

feat(verify): the delete-behaviour family — every `deleteBehavior` a reference field declares is what a delete of the referenced record does, runnable as `os verify --delete-behaviors` (#15953)

Clause-②: yes

A fourth derived proof family beside `runCrudVerification`, `runRlsProofs` and `runReferenceShapeProofs`. It needs no hand-written test: from the app's own objects it takes every field whose type is in `REFERENCE_VALUE_TYPES` (`lookup`, `master_detail`, `user`, `tree`) and reads what the declaration states through the spec's own parse of the field (`FieldSchema`), which is the value a built artifact carries: a `lookup` or `tree` that authors nothing states `set_null`, an authored value is kept, and a bare `master_detail` states none. For each field it creates a fresh target record and a holder referencing it, deletes the target by id, and reads back what the engine left, through two doors: the REST data route as the signed-in caller, and the engine's own delete as the system principal.

- `cascade` holds when the holder is gone with the target.
- `set_null` holds when the holder survives and no longer references the deleted record.
- `restrict` holds when the delete is refused with `DELETE_RESTRICTED` naming the holder's object, and both records are still there.
- In every case a second holder, referencing another record of the same target object, must be untouched.

A refusal for any other reason (a hook's veto, a validation rule, a permission) is `unattributed`, so an engine that refused every delete would not read as a proven `restrict`. A field is `proven`, `contradicted` (a delete did something else), `failed` (a door faulted), `inconclusive` (an unattributed refusal, or a fixture the app refused; the report says why), `excluded` or `not-derivable`. `contradicted + failed` is the report's `hardFailures`.

Two shapes are `excluded` rather than given an expectation, because an engine rule decides what a delete does to them, not the declaration: a `set_null` on a required reference (it cannot be cleared), and a field whose parse carries no `deleteBehavior` (a bare `master_detail`, a `user`). A field is `not-derivable` when no fixture can be built from the app's metadata: its target is not an object the app declares (such as `sys_user`), it is `readonly` or `system`, or the CRUD derivation cannot synthesize its holder or target. Only by-id deletes are asked; a predicate or multi-row delete is outside the family.

**`@objectstack/verify` — new exports.**

- `runDeleteBehaviorProofs(stack, token, config, { doors? })` → `DeleteBehaviorReport`. Run it on a fresh stack of its own: every `restrict` probe leaves its records behind.
- `deriveDeleteBehaviorCases(config)`, `formatDeleteBehaviorReport(report)`.
- Types: `DeclaredDeleteBehavior`, `DeleteBehaviorCase`, `DeleteBehaviorDoor`, `DeleteBehaviorAnswer`, `DeleteBehaviorProbeResult`, `DeleteBehaviorFieldStatus`, `DeleteBehaviorFieldResult`, `DeleteBehaviorReport`, `DeleteBehaviorProofOptions`.

```ts
import { bootStack, runDeleteBehaviorProofs, formatDeleteBehaviorReport } from '@objectstack/verify';

const stack = await bootStack(myApp);
const report = await runDeleteBehaviorProofs(stack, await stack.signIn(), myApp);
console.log(formatDeleteBehaviorReport(report));
expect(report.summary.hardFailures).toBe(0);
await stack.stop();
```

**`@objectstack/cli` — `os verify --delete-behaviors`.** Opt-in, like `--reference-shapes`, on a fresh boot of its own. A contradicted declaration, or a door that faulted, counts in `hardFailures` and fails the run. A `tree` field's delete is not honoured today (deleting the parent leaves the child's reference in place), so an app that declares one fails the run with the flag. The `--json` document carries the report as `deleteBehaviors` when the flag is given; without the flag the run and its document are unchanged.

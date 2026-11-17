---
'@objectstack/scenarios': patch
---

fix(scenarios): an operation an earlier write would meet runs on a fresh seeded copy of the app, so an app's one-way state rule no longer leaves the operations after a transition unmeasured

Clause-②: yes (widening) — through `./runner`: the new exported type `FreshCopy`, the new optional last parameter `fresh` of `runHalf`, and the new optional field `RowRestore.freshCopy` (`orchestrate.ts`). Nothing is removed or narrowed; `./score`, `./score/full`, `./export` and `.` are untouched.
Metadata-protocol: none

Before each operation the runner put the rows an earlier turn had moved back to the seeded state by writing them through the app's own data doors, as the admin. A well-built app judges those writes like any other: its validation rules, hooks and record-triggered flows run on them. So on a card with a state machine the restore failed exactly where the app was right. In `asset_lifecycle`, approving scrap request DR-0006 (`submitted` → `approved`) was followed by a write-back to `submitted`, the app's one-way status rule refused it with 400 `VALIDATION_FAILED`, and every later operation of the half read `restore: … not measured`. Even a write-back the app accepted could fire its flows.

Now, in scratch mode (the Run half and the iterate Run half) and in ask mode, the runner still reads the seeded rows before each operation, but when an earlier turn moved one it does not write anything back. It boots a fresh copy of the same app (scratch: the same project; ask: a blank host with the same build installed the same way), signs the personas in, loads the seed and reads the seeded state there, and that operation and every later turn of the half run on the copy. The copy it replaces is stopped. No rule, hook or flow of the app sees a restore, because there is none. The operation's result carries `restored: { freshCopy: [object/id, …] }`, naming the rows that had moved, and it still counts in the `Run-operations` cell's `N started from restored rows`. When the copy cannot boot, or its seed does not load as the run's did (other rows loaded or refused, a permission set not assigned alike), the operation is NOT MEASURED with that reason, never graded on other rows.

The cost is one boot, the persona sign-ins and one seed load per operation that follows a write, paid only then. A run where no earlier turn moved a row boots nothing more and records exactly as before.

Template mode keeps writing the rows back through the app's doors: its app holds the agent's iterate, made live, which a host booted again would not hold.

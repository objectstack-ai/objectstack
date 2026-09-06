---
"@objectstack/service-automation": minor
---

The run step log tells a `parallel` branch apart from a `loop` row: `iteration` is the enclosing loop's iteration, always, and the branch index moves to `branch`.

The engine half of the ruling `@objectstack/spec` already declares (`ExecutionStepLogSchema.branch`). One field used to hold both meanings, told apart only by reading `regionKind` first, and `runRegion`'s tagger let the innermost region win outright — it skipped any step a nested region had already tagged. Together those two facts made `loop { body: [ parallel { branches } ] }` unreadable: every branch step recorded its branch index and **no** step of that branch recorded the row it ran for, so a per-row failure inside a branch was attributable to a branch and never to a row. That is the shape a fan-out inside a sweep has, and the one an operator most needs to read.

- **`branch` is written, and only inside a parallel branch.** `parallel` tags its branch regions with `branch: i` instead of `iteration: i`. A step outside a parallel branch carries no `branch` at all.
- **`iteration` is single-valued and carried through nesting.** `runRegion`'s tagger now splits what "innermost wins" governs. The IDENTITY fields — `parentNodeId`, `regionKind`, `retryAttempt` — answer *which region ran this step* and still belong to the innermost region outright; an enclosing region never relabels them. The INDEX fields — `iteration` and `branch` — answer *which pass of which region*, and nested regions contribute different ones that are both true of the same step, so an enclosing region now fills the index the inner region left undefined instead of being turned away at the door. A branch step inside a loop body therefore carries **both**: the row on `iteration`, the branch on `branch`.
- **`try` / `catch` inside a loop is unchanged**, deliberately. Such a region has no index of its own, so its steps keep carrying the enclosing loop's `iteration` with `regionKind` still naming the region, and gain no `branch`. It is the control arm of this change, not a subject of it.
- **Nested loops are unchanged too.** "Fill only what is undefined" still holds in both halves, so for `loop { loop }` the inner loop's `iteration` stands.

`StepLogEntry` (exported) gains `branch?: number`. It is not derived from the spec type, and is now held equal to it by a type-level pin rather than by a comment claiming they agree.

**Reading a run recorded before this change.** `iteration` on a `regionKind: 'parallel-branch'` step written by an older engine is a BRANCH index, not a row — the same absent-versus-zero care the run summary's other counters need. Nothing is migrated and nothing is defaulted: a step with no `branch` key is either a pre-change record or a step that ran outside a parallel branch, and `regionKind` is what tells those apart. Bumped `minor` rather than `major` to match the contract half of the same ruling, which shipped its declaration change that way.

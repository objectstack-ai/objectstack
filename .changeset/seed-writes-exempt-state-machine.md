---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

Exempt curated seed writes from `state_machine` validation (#3433).

A seed is a snapshot of established facts — a project already `completed`, an
opportunity already `closed_won` — not a record walking its lifecycle. But once
an object declared `state_machine.initialStates` (#3165), the write path enforced
the FSM entry point on **every** insert, so seed replay silently rejected every
mid-lifecycle row and cascaded its master-detail children. That is the "installed
but no data" failure for the showcase board (1 of 5 projects), and it would hit
every marketplace template (a `closed_won` opportunity, a `closed` case) plus the
rehydrate-heal and per-org replay paths.

`SeedLoaderService` now marks its writes with a server-set `ExecutionContext.seedReplay`
flag; the engine passes `skipStateMachine` to the rule evaluator for those writes,
which skips the `state_machine` rule on both insert (`initialStates`) and update
(transitions). The exemption is scoped to `state_machine` only — a seed must still
satisfy every other validation (`format`, `cross_field`, `script`, `json_schema`,
`conditional`). Because all seed paths funnel through `SeedLoaderService.SEED_OPTIONS`,
the fix covers boot inline seed, marketplace install/heal, and per-org replay at once.

The showcase project seed drops its three-phase FSM-walk workaround (#3415) and
seeds each project directly at its real status again.

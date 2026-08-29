---
"@objectstack/spec": patch
---

docs(spec): `FlowFunctionEffectSchema`'s broken-sweep claim is a first FILTER, not the detector (#12685)

`patch`, and not empty: these doc blocks ship in `.d.ts`, and this file's
`@module` block is emitted verbatim as the intro of
`content/docs/references/automation/flow-function.mdx` — so the sentence an
operator reads while wiring an alert is a published artifact of this package,
regenerated in this change. No schema, no accept set, no runtime behaviour
moves.

## The wrong claim

`packages/spec/src/automation/flow-function.zod.ts` stated
`selected > 0 AND acted = 0 AND unmeasured = 0` as *the* broken-sweep query,
unqualified — the third `packages/spec` surface carrying it, outside the fence
of the change that corrected `automation/execution.zod.ts` and
`integration/connector.zod.ts`. #12685 measured the A/B on one graph pair
through the real engine (pinned in `run-summary.test.ts`): a healthy idempotent
sweep — re-select the same records, gate each one on "already handled" — and a
dead gate BOTH report `selected > 0, acted 0, unmeasured 0`. "Over N
consecutive runs" does not rescue it: the healthy steady state is persistent
for as long as the outstanding work stands, so it trips on every run;
consecutiveness filters flapping, which is a different failure.

The failure mode is silent. An operator who wires an alert to the documented
predicate watches it fire during normal operation and mutes it, leaving a dead
sweep unmonitored *while looking monitored*.

## What the prose says now

The predicate is stated as the FIRST FILTER and the per-node fold
(`FlowRunSummary.nodes[]` / `gates[]`) is named as the discriminator — the same
shape `sys_automation_run`'s field descriptions, `content/docs/automation/
flows.mdx`, `automation/execution.zod.ts` and `integration/connector.zod.ts`
now agree on. Each clause keeps its own true point: a declared-`writes`
function makes `acted` INCOMPLETE rather than zero, which is why
`unmeasuredEffect` keeps the first filter off the flows that call one, and an
under-reported `selected` can still only make the filter quieter, never wrong.

Five mentions in the file were triaged individually; the one that reads
"an under-report reads exactly like the broken sweep #4354 exists to detect"
was left standing, because it claims nothing about the three-clause predicate
and stays true.

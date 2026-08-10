---
"@objectstack/example-todo": patch
---

fix(example-todo): `task_completion` is a real record-change flow again — it bound to nothing and gated on a key nothing reads (#6882)

`examples/app-todo`'s `TaskCompletionFlow` declared `type: 'record_change'` and then
declared neither key that arms one. It was 1 of the 34 authored flows across the three
bundled apps, and the only dead one.

**Two faults on one start node, both silent.**

1. **No `triggerType` at all.** `AutomationEngine.resolveTriggerBinding` claims a
   record-change flow only when the authored token starts with `record-`. With the key
   absent every later branch missed too (`timeRelative`, `config.schedule`,
   `flow.type === 'schedule'`, `flow.type === 'api'`), the method returned `undefined`,
   and `activateFlowTrigger` returned without binding. The flow declared itself
   record-triggered and was, at runtime, a manual flow that never fired.
2. **The predicate was written to `triggerCondition`.** The trigger gate is
   `config.condition` — the key the binding copies and `execute()` evaluates. A node
   `config` is an open slot by design (ADR-0018), so the misspelling parsed silently.
   Fixing (1) alone would have been *worse* than dead: the flow would have fired on every
   update of every task.

**Why no channel reported it.** `getTriggerBindingAudit` — the platform's own silent-miss
surface, and the source for both the automation plugin's `kernel:bootstrapped` warn loop
and the CLI startup summary's `unbound` list — opens with `if (!resolved) continue`,
reading "no binding" as "manual/screen flow, nothing to bind". So the missing key did not
*add* a diagnostic; it removed the flow from every diagnostic channel there is. The only
trace anywhere was the startup banner counting one more flow registered than bound, with
no name and no reason.

**The repair.** `triggerType: 'record-after-update'` plus the predicate moved to
`config.condition` as `status == "completed" && previous.status != "completed"` — the
shape `showcase_task_completed` already uses for this exact semantic. `-after-update`
rather than `-after-write` on purpose: "marked as complete" is a transition, and the
insert leg has no `previous` to transition from — `previous` binds to `null` there, and
`previous.status` against `null` aborts the whole CEL predicate with `No such key:
status` rather than answering false.

A third fault surfaced the moment the flow could run: `get_task` filtered on `{taskId}`,
an `isInput` variable nothing ever bound (a record-change run seeds `params` from the
triggering record, which carries `id`, not `taskId`), so the first armed run failed with
"1 filter condition(s) resolved to nothing and were dropped from the query". It now reads
`{record.id}`, the handle every other record-change flow in the corpus uses, and the dead
declaration is gone.

`@objectstack/example-todo` also runs its own vitest suite now (`vitest run`, as
`app-crm` and `app-showcase` already do) instead of `objectstack test`, which is a
Quality-Protocol runner that needs a live server and matched no `qa/*.test.json` here —
so the package's test files had never executed in CI.

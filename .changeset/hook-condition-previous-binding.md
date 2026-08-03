---
'@objectstack/objectql': minor
---

**A declarative hook `condition` can now express a TRANSITION: the CEL scope binds `previous` alongside `record` (#4784).**

The condition gate evaluated against a single root — `{ record }`. Both published skill
docs, however, taught the `previous` form: `objectstack-formula` §5 ("Update hook
condition — `previous` vs `record`") gives
`P\`previous.status != 'escalated' && record.status == 'escalated'\``, and its legacy
migration table maps `OLD.x` → `previous.x` and `ISCHANGED(x)` → `previous.x != record.x`.
Written into a hook, any of those aborted the expression with `No such key: previous`,
which the gate swallowed into `false` — the hook simply never ran, leaving one WARN line.
Declared ≠ delivered.

It became load-bearing with #4770. `record` now means the record's **state** (stored ⊕
payload), so `record.done == true` is true on *every* update of an already-done row — not
only the one that completed it. `showcase_audit_task_completion`'s own description says
"after a task transitions to done", and there was no way to write that. Now there is:

```ts
condition: P`previous.done != true && record.done == true`
```

`previous` is built exactly as the validation side builds it (#4649), through the shared
`materializeDeclaredFields` helper, so one CEL expression means one thing on both
surfaces:

- **the stored pre-write row**, made **total over the object's DECLARED fields** — a
  column the driver never returned reads as `null` instead of aborting the expression;
- **declared fields only** — `previous.dnoe` stays unevaluable, so a typo is still
  reported rather than quietly answered;
- **copied, never mutated in place.** `ctx.previous` is the engine's own pre-image object,
  observed by every after-hook; the materialised `null`s do not leak into it.

**Where `previous` is NOT bound** — verbatim the rule `validation/rule-validator.ts`
already applies, so referencing it there makes the condition unevaluable:

- **insert events** (`beforeInsert` / `afterInsert`) — there is no prior state. Write
  insert conditions over `record` alone.
- **predicate (`multi: true`) bulk updates** — one write matches N rows and the hook fires
  once, so there is no single prior record. Binding `{}` or `null` would answer
  `previous.x == null` with a fabricated fact about rows nobody read.

**Cost: none.** No new demand-driven fetch was introduced. `previous` rides on the prior
row `engine.update` already reads whenever an afterUpdate hook is registered — the same
one that feeds `ctx.previous` and record-change flow triggers. A condition that never
mentions `previous` reads nothing extra, pinned by test.

**What you may see after upgrading:** hooks whose condition referenced `previous` never
fired before and start firing now. That is the declaration finally being honoured — review
any hook carrying a `previous.*` condition before you upgrade.

**Unchanged, deliberately:** a condition that is *still* unevaluable is logged at WARN and
treated as `false`. Whether that should fail loudly instead is tracked separately.

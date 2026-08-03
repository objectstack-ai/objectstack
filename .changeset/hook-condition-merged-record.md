---
'@objectstack/objectql': minor
---

**A declarative hook `condition` is now evaluated against the RECORD — the stored row overlaid with this write's payload — not against the update payload alone (#4770).**

⚠️ **Behaviour change — read this before upgrading.** The condition gate used to evaluate
against `ctx.input.data`: only the fields the current write happened to carry.
`ctx.previous` sat behind it, unreachable, and the two were never merged. So a condition
could reference only a field the update *happened* to touch; referencing anything else
aborted the CEL expression with `No such key` — which the gate swallowed into `false`,
leaving one WARN line as the sole trace.

For a guard-style hook that reads as "let it through"; for an audit-style hook it reads as
"do not record it". `condition: "record.done == true"` on an audit hook therefore did NOT
run on the most ordinary updates there are — change the status, change the assignee —
because `done` was not in the payload.

The record a condition reads is now built the same way a validation predicate's is
(#1871 / #4649, via one shared helper so the two cannot drift):

- **stored ⊕ payload** — the prior record overlaid with this write's data, so a condition
  may reference any field of the record, not just the changed ones. The payload still
  wins for the fields it carries.
- **total over the object's DECLARED fields** — `null` for a declared field present in
  neither, so a driver that stores only the columns it wrote no longer decides whether an
  expression is evaluable.
- **declared fields only** — an undeclared or typo'd key (`record.stauts`) stays
  unevaluable and is still reported, exactly as before.

Materialisation happens only when the persisted state is actually in hand — an insert, or
an update whose prior row was fetched. A predicate (`multi: true`) bulk update carries no
prior row, so its payload is left as it is rather than gaining `null`s that would
contradict the stored rows. No code path fetches a record it did not already load.

**What you may see after upgrading**

- **Conditions that never fired start firing.** A hook gated on a field the payload rarely
  carried was silently skipped; it now evaluates. This is the declaration finally being
  honoured, but expect hooks to run on writes where they previously did not.
- **A condition is now about the record's STATE, not about this write's diff.**
  `record.done == true` fires on every update of a task that *is* done, not only on the
  update that set it. A condition cannot express a transition today — the CEL scope binds
  `record` only.
- **Conditions guarded with `has(...)` need `!= null`.** `has(x)` asks whether the key is
  **present**, and a declared field holding `null` is present — so
  `has(a) && has(b) && a > b` still faults on `null > null`. Same lesson as #4649:

  ```diff
  - condition: 'has(record.spent) && has(record.budget) && record.spent > record.budget'
  + condition: 'record.spent != null && record.budget != null && record.spent > record.budget'
  ```

  `has()` remains correct for asking whether an **undeclared** key exists.

**Unchanged, deliberately:** what happens when a condition is *still* unevaluable after
merging — it is logged at WARN and treated as `false`, as before. Whether that fallback
should differ by hook category (a guard fails open, an audit fails silent) is a separate
decision, tracked on its own issue.

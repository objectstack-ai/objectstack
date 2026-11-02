---
'@objectstack/lint': minor
---

feat(lint): the publish-time null-guard gate judges a record-triggered flow's start, edge and decision-branch conditions

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package's public surface is retired: the publish-time null-guard gate now judges three predicate slots of a record-triggered flow that it already judges on validation rules and hook conditions. A flow it now refuses is fixed in the flow's own expression (add the `!= null` test the message names), so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

`os build`, `os validate`, `os lint` and the runtime publish gate now refuse a record-triggered flow (start `triggerType: 'record-…'`) whose start condition, edge `condition` or `decision` branch `expression` applies an ordering (`< <= > >=`) or arithmetic (`+ - * / %`) operator to a nullable declared field of the trigger object with no `!= null` / `== null` / `!isBlank()` test in front of it. The run's `record` and `previous` carry every declared field, nulls included, so such a comparison faults with `no such overload` on the first record where the field is empty, and the run fails there (the write that fired it still lands).

- **Who moves.** A flow condition such as `budget > 200000` on an optional `budget`. Fix: `budget != null && budget > 200000`, or put the `!= null` test in the flow's start condition, which gates every run, so every edge and branch after it may compare freely. `has(record.budget)` is not a guard: the key is always present.
- **Bare names count.** The run spreads the record's fields to top level, so a bare `budget` is read as `record.budget`, unless the flow declares a variable or a node id of that name, or has a node that can bind names nobody declared (a `script`, `connector_action`, `wait`, `subflow` or `map`); those bare names are not judged. At the runtime publish gate bare names are not judged, so a bare start-condition guard proves nothing there: a flow whose start condition is `budget != null` and whose edge compares `record.budget > 200000` passes `os validate` (where the flow's bound set is provable) and is refused by the runtime publish gate. Spell the start guard `record.budget != null` and both accept it.
- **Not judged.** Flows with no record trigger (an `api` flow's request body, an action's or `map` item's record are not made total), a `screen` field's `visibleWhen`, and `config.condition` on any node but `start`.
- **Fewer findings elsewhere.** A `count` or `sum` roll-up summary is now always valued for this gate (zero children is zero), on validation rules and hook conditions too; `min` / `max` / `avg` roll-ups stay nullable. That presumes `os migrate summary-nulls` ran: on a database upgraded in place without it, a parent row stored before roll-ups were seeded at create time, and no child of it written since, still reads `null`.

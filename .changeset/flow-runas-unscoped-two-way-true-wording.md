---
"@objectstack/lint": patch
---

fix(lint): `flow-runas-unscoped` stops telling an author they declared a `runAs` they never wrote (#5693)

The rule's message branched on whether `runAs` was **authored** or **defaulted**:

```ts
typeof flow.runAs === 'string' ? `runAs:'user'` : `the default runAs:'user'`
```

That distinction is real and useful — "you wrote something incoherent" is not
"you inherited a default that does not fit a user-less trigger" — but the rule
cannot observe it, and which arm an author got depended on the **surface** rather
than on their file.

**On the CLI, only the explicit arm was reachable.** `FlowSchema.runAs` carries
`.default('user')` and the registry wires this rule `input: 'parsed'`, so
`flow.runAs` is the string `'user'` whether the author wrote it or not. `os lint`
does not Zod-parse, and would have escaped that — except `defineStack` /
`defineFlow` parse at *definition* time, so the config module hands even the
non-parsing command a stack with the default already filled in.

Measured on `examples/app-todo`, `overdue_escalation` with its `runAs` line
deleted — the author declared nothing:

```
BEFORE — os validate
  flow 'overdue_escalation' · runAs: schedule-triggered flow runs as `runAs:'user'`, but a
  schedule run has no trigger user — so its data node 'get_overdue_tasks' (get_record) …

BEFORE — os lint
  ✗ flow 'overdue_escalation' · runAs: schedule-triggered flow runs as `runAs:'user'`, but a
  schedule run has no trigger user — so its data node 'get_overdue_tasks' (get_record) …
```

Both commands told someone who had written no `runAs` that their flow "runs as
`runAs:'user'`" — which invites *"I never wrote that, the tool is confused"* at
exactly the moment the tool is right and the fix is one line away.

Meanwhile the **runtime publish gate** (#4463) judges the verbatim authored body,
so it really did reach the other arm — the same flow was told two different
things by two shipped surfaces.

**What changed.** One sentence, true of both authoring inputs, on every surface:

```
AFTER — os validate and os lint, identical
  flow 'overdue_escalation' · runAs: schedule-triggered flow runs under `runAs:'user'`
  (the default when none is declared), but a schedule run has no trigger user — so its
  data node 'get_overdue_tasks' (get_record) has no identity to scope to and will be
  REFUSED at run time.
```

The parenthetical is a statement about the **value**, not an accusation about the
author, so it stays true for someone who did write `runAs:'user'`. This is the
house pattern rather than a new one: `flow-draft-status-ambiguous` says `has
status 'draft' (the default when none is authored)` for the same reason, on the
same mechanism.

Only the wording moved: the same flows are flagged, with the same
`severity: 'error'`, the same `where`, the same `hint`, and the same region
clause when the evidence node is nested.

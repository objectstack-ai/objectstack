---
"@objectstack/plugin-sharing": patch
---

feat(plugin-sharing): an `isSystem` write batch that materialises zero sharing grants now says so, once (#6783)

The sharing-rule record-write hooks skip `isSystem` sessions, so a seed run — or
any internal write batch — lands rows on an object an **active** sharing rule
covers and creates no `sys_record_share` rows at all. The skip is correct: the
`kernel:bootstrapped` backfill reconciles every rule and `evaluateRule` is
idempotent, so the state heals. What was wrong is that nothing said so.

hotcrm#640 is the specimen: a fresh install with 9 active sharing rules, 9
accounts matching their criteria, users holding the right positions — and an
empty `sys_record_share`. Every visible layer said "configured". The only way to
learn that the seed path had skipped materialisation was to query the table,
find it empty, and read `plugin-sharing`'s source.

**What changed.** The two skips that drop grant materialisation — `afterInsert`
and `afterUpdate` — now emit one INFO line naming the behaviour and both
remedies:

```
[sharing-rule] sharing materialisation skipped for isSystem writes; re-evaluate rules or restart to backfill
```

with the object and the active rules on it as metadata.

**One line per batch, not per row.** The notice is latched per object per hook
binding generation, so a seed batch writing 500 rows produces exactly one line.
The defect being fixed is silence; a per-row flood would be the same defect with
a different symptom. The latch re-arms with the binding — `bindRuleRebindTriggers`
re-binds the package on every `sys_sharing_rule` write — so a changed rule set
gets its own notice instead of inheriting the previous generation's silence.

**INFO, not warn or error**, deliberately: the behaviour is correct and
self-healing, and warning about a subsystem working as designed is how operators
learn to ignore it.

Deliberately unchanged:

- **The skip itself.** No write now materialises grants that did not before, and
  no `sys_record_share` row is created, updated or revoked by this change.
- **No new switch or flag.** The notice is unconditional.
- **`afterDelete` stays silent.** A delete skips *revocation*, not
  materialisation, and the remedy the line names cannot repair that class:
  `evaluateRule` iterates records that still exist, so neither re-evaluating a
  rule nor restarting can reach a grant whose record is gone. That class belongs
  to the record-delete share cascade and the boot orphan sweep.

The line is a statement about the write path, not a claim that grants were owed —
whether a given seeded row satisfies a rule's criteria is exactly the query the
skip exists to avoid, so answering it here would cost the skip its purpose.

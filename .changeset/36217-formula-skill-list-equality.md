---
'@objectstack/skills': patch
---

docs(skills): `objectstack-formula` says that `==` / `!=` between a list-valued field and a scalar is refused, and teaches the membership test each site takes

Clause-②: no
Metadata-protocol: none

The CEL cheat-sheet of the `objectstack-formula` skill gains a note under its operator table: `==` / `!=` between a list-valued field (`multiselect`, `checkboxes`, `tags`, or a `select` / `radio` / `lookup` / `user` / `file` / `image` field with `multiple: true`) and a scalar literal is refused by the validator as `list-equality` ("list compared with a scalar"), because CEL compares the whole list and the expression answers one constant on every row. The note shows the refused form and the rewrite the refusal prescribes at each site, null-guarded (`in` faults on a `null` list) and parenthesised whole, for `==` and for `!=`:

- where the expression is evaluated as CEL: `(has(record.tags) && record.tags != null && 'vip' in record.tags)` and `(!has(record.tags) || record.tags == null || !('vip' in record.tags))`; the `has()` covers a sparse action row and a `previous` that is `null`;
- a bare name in a flow condition: `(tags != null && 'vip' in tags)` and `(tags == null || !('vip' in tags))`, since `has()` takes no bare name;
- a sharing rule's `condition`, which is compiled to a query filter: `(record.tags != null && record.tags.contains('vip'))` and `(record.tags == null || !record.tags.contains('vip'))`, since `has()` and an `in` with the literal first do not lower there.

This is the behaviour `@objectstack/formula` already ships; the skill only teaches it.

Paid for by deletion in the same file, with the token ceiling unchanged (6008): twelve restatements were cut, each keeping another home — the `has()` section's opening sentence (the cheat-sheet `Key existence (NOT null-safety)` row and the paragraph that follows it), the Salesforce-flavor block's `os build` / runtime clause (the `Verify your work` section), the sentence saying hook conditions and validation predicates bind the same two roots (the `previous` table under it), the sentence saying record-change flow triggers ride the same dispatch (the same table's `after*` row), the closing "It is a refusal" sentence of the 10 000-row paragraph (that paragraph's own "the platform refuses"), the translation table's `"abc"` row (the cheat-sheet `String literal` row), the stdlib intro's "there is no `src/` to read" clause (the same sentence's "ships `dist` only"), the "use `daysBetween` / two `datetime(…)`" sentence of the date-arithmetic note (the table under it), the sub-day-offset row's "the calendar helpers land on UTC midnight" (the `today()` / `daysFromNow` / `daysAgo` rows), the "`previous.status`, where `previous` is `null`" parenthesis of the unevaluable-condition warning (the `previous` table's insert row), the second transition-condition example (the section's first example, the same shape), and the first half of the translation table's `previous.x` warning (the `OLD.x` and `ISCHANGED(x)` rows above it and the same insert row).

Two eval cases exercise the note: a hook `condition` over a `tags` field (the CEL spelling) and a sharing rule `condition` over the same field (the `.contains()` spelling).

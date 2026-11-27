---
'@objectstack/formula': patch
'@object-ui/app-shell': patch
---

fix(studio): a list condition built in Studio is the membership the validator prescribes for its site, so it no longer faults on a sparse action row or on a `previous` that is null on a create

Clause-②: yes
Metadata-protocol: none

`@objectstack/formula` exports `listMembershipSource(read, member, contains, filterCompiled?)` and its `ListSubjectRead` type: the list-membership test for one site, unparenthesised. The `list-equality` refusal's rewrite is this text in parentheses. The Studio builders now take their spelling from the same place, for the two sites they write: `has(S) && S != null && V in S` (complement `!has(S) || S == null || !(V in S)`) for a `record.` or `previous.` read, and `S != null && V in S` for a bare name in a flow. The third arm, `S.contains(…)` where the condition compiles to a query filter (a sharing rule's `condition`), is the validator's alone: no Studio host tells the builder that a mount is filter-compiled, so the builders never write it (follow-up: objectstack-ai/objectstack#37847).

The Studio condition builder and the flow edge's condition rows (`@object-ui/app-shell`) write membership through it. Before, both wrote `S != null && V in S` for every subject, and on an action's `visible` / `disabled` / `pressed`, whose row carries only the fields the list fetched, `record.labels != null` faults with "No such key" when `labels` is absent; on a create `previous` is null and `previous.labels != null` faults the same way. A bare name in a flow's start condition is written as before.

A `record.` or `previous.` condition the builder stored in the old unguarded spelling opens in the raw CEL editor unchanged instead of as a row. Nothing else to migrate: rebuilding the row in the builder writes the guarded form.

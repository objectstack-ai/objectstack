---
"@objectstack/lint": patch
---

fix(lint): stop the `readonlyWhen` hints ruling out the remedy that works and offering one that does not (#13832)

Message text only. Rule ids, severities and match sets are untouched, and no
finding changes shape — but the hint **is** the whole product of an advisory
rule (neither finding blocks a build), so the sentence is all the author acts
on, and both of these sentences were measured false against the engine.

`flow-update-readonly-flow-writes`' `flow-update-readonly-when-field` hint said:

> If automation must maintain this field regardless of record state, run the flow runAs:'system'.

It does not. The conditional strip has **no `isSystem` guard at all** —
`stripReadonlyWhenFields` runs unconditionally on the update path, unlike the
static `readonly` strip beside it that really is skipped for system callers.
So the advice bought the author a `runAs:'system'` flow, a re-run, the same
missing column, and an elevated run identity in the tree with no compensating
behaviour: **a privilege widening for no effect**. Pinned as "LOCK 2 — isSystem
does NOT exempt a caller-supplied value" in
`engine-readonly-when-derived-writes.test.ts`, and from the strict-mode side as
"covers readonlyWhen too — the arm a trusted (isSystem) caller can still hit".

Both the `hook-api-update-readonly-when-field` hint and the matching
`content/docs/automation/hook-bodies.mdx` bullet carried the same defect from
the other direction — they **ruled out the remedy that works**:

> readonlyWhen strips even a beforeUpdate-derived value, so an own-hook stamp is NOT a workaround here

That is the behaviour #9107 removed. The conditional strip now judges the
*caller's* entry snapshot, so a value a `beforeUpdate` hook **derives** is not
caller-supplied and lands even on a locked record —
`engine-readonly-when-derived-writes.test.ts` opens with "THE REPORT: a
hook-derived value on a TRUE readonlyWhen field now LANDS", and pins the bulk
path on the same terms. Between them the two halves left the author's only
working option struck out and a useless one recommended.

All three hints now name the same two measured remedies — confirm the write
only targets records whose predicate is FALSE, or derive the field in a
`beforeUpdate` hook on the target object — and refuse elevation explicitly,
matching the shape `action-api-update-readonly-when-field` already shipped.
The hook hint keeps its stronger, separate reason that `sudo()` is a
`TypeError` from a sandboxed body, and now also carries the reason that
survives if that one is ever fixed: a system context does not waive the
conditional lock either.

Deliberately **not** flattened: the static-`readonly` hints and docs rows that
recommend elevation stay exactly as they are, because for *that* strip
elevation is the intended channel. The two disagree for a reason, and a pin now
holds them apart.

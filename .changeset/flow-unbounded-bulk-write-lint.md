---
"@objectstack/lint": patch
---

feat(lint): warn when a `multi: true` delete/update is bounded by nothing — the declared whole-object write (#5482)

A `delete_record` / `update_record` node that declares `multi: true` with no
`filter` (or an empty one) writes the **whole object**: the executor forwards
`where: {}` plus the bulk intent, the data engine classifies that as a legal
`multi` call, and it lands on `driver.deleteMany` / `driver.updateMany` with no
predicate. Every row, every run.

That path only became authorable with #5393, which gave these nodes a bulk
declaration at all — before it the executor never passed `options.multi`, so the
engine refused every predicate write (`Delete requires an ID or
options.multi=true`) and "empty filter + bulk intent" was not a reachable shape.
Since then it has been reachable and **silent**: `filter` is optional, `multi` is
optional, nothing related the two, and the author's only feedback was the step's
`acted` row count — reported after the rows were gone. The common way to get
here is not malice but an omission: declaring the bulk intent and forgetting the
constraint.

`os validate` / `os build` now report `flow-multi-write-unfiltered` for it:

```
flow 'nightly_purge' · node 'purge' (delete_record)
  declares `multi: true` with no `filter` key — this is a WHOLE-OBJECT write,
  by declaration: every row of 'lead' is deleted on every run. …
```

**A warning, not a gate.** An explicit whole-object purge is something the
platform grants on purpose — the data engine's own dispatch case-set lists "bulk
intent with no predicate at all" as a valid call — so the shape has a legitimate
reading and the run-time path stays open. What was missing was only that the
author hears about it *before* the rows go. For the same reason the fix is not a
schema `refine`: forbidding the shape would delete an intent the engine grants.

Two ways to satisfy the warning: write the constraint you mean into `filter`
(the bounded-bulk reference shape is app-showcase's `showcase_inquiry_purge`), or
confirm that emptying the object is the intent and keep it.

**It does not duplicate the #3810 run-time guard, which judges a different
fact.** That guard refuses a node when a condition the author *wrote*
interpolated to nothing (`{record.ownr}` — a typo — leaving `{}`), and it is
deliberately keyed on "a written condition is gone" rather than on "the filter is
empty", because losing one of two conditions also widens the blast radius. So:

| fact                          | judged by          | when      | verdict |
|-------------------------------|--------------------|-----------|---------|
| a written condition vanished  | #3810 filter guard | run time  | refuse  |
| no condition was ever written | this rule          | authoring | warn    |

A node with `filter: { owner: '{record.ownr}' }` is silent for this rule (a
condition *is* written) and refused by that one; a node with no `filter` at all
is warned about here and — correctly — allowed there. The diagnostic names the
run-time guard so the two are not mistaken for one check.

Reported at every nesting depth, which matters because a scheduled sweep whose
per-item work sits in a `loop` body is the standard janitor shape: a finding
inside a region carries the region scope (`flow 'x' · loop 'sweep' body · node
'purge' (delete_record)`), on the traversal #5383/#5635 added to this family.

Deliberately out of range: an empty **combinator** array (`{ $and: [] }`,
`{ $or: [] }`). #5322/#5134 ruled those and every driver implements the ruling —
empty `$and` is TRUE (so it *is* a whole-object write), empty `$or` is FALSE (so
it matches nothing and must never be warned about) — but telling them apart
requires the boolean-identity reduction, which already exists producer-side in
each driver. A hand-written fourth copy inside a linter is how a scan and a
validator come to answer with two different predicates, so that case is tracked
separately instead.

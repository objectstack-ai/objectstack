---
"@objectstack/lint": patch
---

fix(lint): `flow-runas-unscoped` now sees data nodes nested in a `loop` body / `parallel` branch / `try_catch` region (#5633)

**This widens the coverage of a build-GATING rule.** `flow-runas-unscoped` is
`severity: 'error'`, so a flow it newly catches goes from a green build to a
failed one. That is the correct outcome — those flows cannot run at all — but it
is a real blast radius and the reason this shipped as its own change rather than
riding along with #5383.

**What was wrong.** #5383 gave the flow anti-pattern family a per-region walk and
deliberately left this one rule reading the flow's **top-level** `nodes` only. Its
data-node search is the rule's evidence that the flow *performs a data operation
at all* — and a data node inside a `loop` body is exactly as unscoped as one at
the top level. So a scheduled flow that queried a set, looped it, and wrote per
item passed `os build` / `os validate` clean and was then **refused at run time**:
since #3760 a user-less run really does refuse the data operation rather than
running it unscoped. Passing the build and then being unable to run is precisely
what promoting this rule to `error` was for, and the shape it was missing —
query, loop, write per item — is *the* standard shape for a scheduled flow, so
the write is almost always the nested node.

Measured, same flow with only the node's position changed:

```
update_record at TOP level     -> 1 finding [error]
update_record INSIDE loop body -> 0 findings   (now: 1 finding [error])
```

**What changed.** The data-node search runs across `collectFlowGraphs(flow)` —
every ADR-0031 region, at any depth — while the finding itself stays **flow-level**
exactly as before: one per flow, `where` = ``flow 'x' · runAs``, because `runAs`
is a flow property and the region only supplies the evidence. The region is named
in the **message** so you can find the node:

```
flow 'nightly_sweep' · runAs: schedule-triggered flow runs under `runAs:'user'`
(the default when none is declared), but a schedule run has no trigger user — so its
data node 'touch' (update_record), in loop 'loop_rows' body, has no identity to scope
to and will be REFUSED at run time.
```

(The sentence's opening was re-worded by #5693 in this same release window; the
sample above is the wording that actually ships.)

**Nothing about the top-level case moved.** A flow whose evidence is a top-level
data node produces the same message with no region clause, and when a flow has
data nodes at both altitudes the top-level one is still the node cited —
`collectFlowGraphs` yields the flow's own graph before it descends. Both are
pinned by tests.

**If this newly fails your build:** the flow was already broken at run time. Add
`runAs: 'system'` to declare the elevation the sweep needs (a schedule /
time-relative / API run has no user to scope to — there is none). See ADR-0049,
ADR-0073 D5, #1888, #3760.

The repo's three example apps (`app-showcase`, `app-crm`, `app-todo`) are
unaffected — `os validate` output is line-for-line identical before and after.

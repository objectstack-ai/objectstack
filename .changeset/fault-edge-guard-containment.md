---
"@objectstack/service-automation": minor
---

fix(automation): a `fault` edge must not switch off a guardrail (#3863)

A `fault` edge routes a failed node to a handler instead of aborting the run.
That is the right primitive for the world not cooperating — an `http` node that
404s, a connector that rate-limited, a rejected write.

It was also, until now, routing the **refuse-to-execute** family. Those guards
report that the METADATA is wrong, not that an operation failed: #3810
(interpolation erased a filter condition), ADR-0049/#1888 (the run would execute
unscoped), a data node naming no object. Because they surfaced as ordinary node
failures, one declared edge silently disabled them.

**The live consequence, reproduced in a test before the fix:** attach a `fault`
edge to a `delete_record` whose filter has a typo (`{record.ownr}`), and #3810's
protection against emptying the object was gone — the guard fired, the handler
swallowed it, and the run reported `success: true`. That is the exact fail-open
direction #3810 was opened to close, reachable from a single edge, and it is the
kind of suppression an AI authoring loop reaches for first when trying to make a
diagnostic go away.

**Failures now carry a class.** `NodeExecutionResult.errorClass` is `'runtime'`
(default — every existing executor keeps its current routing) or `'guard'`.
Guard-class failures are never routed: they stay fatal with or without a `fault`
edge, and the run fails with the guard's own message. Thrown guards are covered
too — `UnscopedRunDataAccessError` is branded via a shared `guard-refusal`
module, so the engine's catch path cannot become the bypass the return path no
longer is.

Marked as guard-class: the three `resolveNodeFilter` refusals (#3810), the four
`objectName required` refusals, and `UnscopedRunDataAccessError` (ADR-0049).
Genuine engine failures (`get_record(x) failed: …`) stay runtime-class and keep
routing.

**Also in this change**

- `{<nodeId>.error}` now carries a failed node's message alongside the run-wide
  `{$error}`. `$error` names only the most recent failure, so a handler shared by
  two fault edges could not tell which node it was handling; `{charge_card.error}`
  is addressable from any downstream template. Additive — `$error` is unchanged.
- Fault edges are **documented** for the first time (`content/docs/automation/flows.mdx`
  and the automation skill), including the routable/not-routable split. The skill
  entry says plainly not to add a fault edge to silence a guard error, since that
  is the misuse the class split now makes impossible.

A run that takes a fault branch still reports success, and the failed step still
carries `status: 'failure'` and its message in the trace — recovery does not
erase the record of what failed (#3356/#3407).

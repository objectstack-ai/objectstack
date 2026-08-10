---
"@objectstack/objectql": major
"@objectstack/metadata-protocol": patch
"@objectstack/spec": patch
---

<!-- adr-0087: registered engine-find-formula-order-by-refused -->

fix(objectql)!: `engine.find` / `engine.findOne` refuse an ORDER BY they cannot materialise (#7095)

`engine.find()` and `engine.findOne()` are a **public API**, and an `orderBy`
naming a `formula` field — which used to return rows successfully, in an
arbitrary order — now **throws `400 INVALID_SORT`**.

#6994 closed this at the REST ingress (`assertSortFieldsExist`), covering
everything that reaches `findData`: the list route, `POST /data/:object/query`,
the export route and the RPC dispatcher. A caller reaching the engine directly
passed through none of it. Measured on the base of this change, real `ObjectQL`
over a driver that really sorts:

```
engine.find(o, { orderBy: [{ field: <formula>, order: 'asc'  }] }) -> C A E B D
engine.find(o, { orderBy: [{ field: <formula>, order: 'desc' }] }) -> C A E B D
                                             asc === desc (byte-identical)
```

A `formula` value is computed on read, so no driver materialises a column for
it: the ORDER BY reached the driver, found nothing, and the unknown-column
backstop returned the rows unordered under a success — carrying the very values
they were asked to be ordered by. With `limit`, "the latest N" was an arbitrary
N that no amount of inspecting the response could reveal.

- FROM `orderBy: [{ field: '<formula field>' }]` → TO: denormalise the value
  onto the object (a stored field, written when the source changes) and sort by
  that. This is the same remedy, in the same words, that the REST door has
  prescribed since #6924 / #6994 and that the SEARCH axis prescribes since
  #6673 — a caller refused at two doors is not sent two different ways.

**`summary` / rollup fields are NOT affected** and still sort in both
directions: they get a real, maintained column. The family this refuses is
`formula`, not "computed" — widening it to the spec's `COMPUTED_VALUE_TYPES`
(the *write* contract) would break two types that work, and a control test pins
that.

**Who was actually reaching this.** The #7095 ruling required the internal-caller
tolerance to survive only behind a pinned internal path, and only if a *measured*
internal call site relied on it. The sweep of every in-tree `orderBy` reaching
the engine directly — hooks, flows, reports, queue/job adapters, sharing,
metadata loaders, expand sub-reads — found **none**: every hardcoded internal
sort names a real stored column (`created_at`, `updated_at`, `version`,
`priority`, `scheduled_for`, `started_at`, `next_run_at`, `recorded_at`, `id`),
and no shipped object in the repo declares a `formula` field at all. So **no
internal path shipped**, and there is no flag to opt back into the drop — a
negative test pins that the public options shape refuses one.

The one **author-reachable** consumer is why leaving this at ingress was not
tenable: a saved report's `query.orderBy` is forwarded verbatim into
`engine.find` by `plugin-reports`, bypassing the ingress gate entirely. A report
authored to sort by a formula field used to run and return an arbitrary order;
it now fails loudly with the remedy in the message.

**One path deliberately does NOT become a refusal.** A nested `expand` sort
raises this same error inside `expandRelatedRecords`, but that sub-read sits in a
pre-existing graceful-degradation `catch` which swallows *every* expand failure
and retains the raw foreign keys. That path therefore moves from **silent** to
**observable** — a warning naming the field and the fix — rather than refusing.
Reversing that backstop is a decision about all expand failure modes (#3821) and
is not ridden in on this change; it is measured and pinned as-is.

**What did NOT change:** the ingress gate is untouched — same message, same
`unknown` > `dotted` > unmaterializable precedence, same `param` name that the
engine cannot know. The engine door judges only the third verdict: unknown and
dotted sort names still reach the driver from a direct call exactly as before,
because refusing those is a posture change on two further axes rather than a
free extension of this one. Reading a formula field, and the projection axis'
`SELECT *` tolerance, are also untouched.

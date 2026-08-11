---
"@objectstack/runtime": patch
---

fix(runtime): a repeated `?paradigm=`/`?source=`/`?category=`/`?type=` on the automation descriptor routes is refused, not answered with an empty palette (#7360)

`GET /api/v1/automation/actions` and `GET /api/v1/automation/connectors` compared
a **raw** query value against a string field:

```ts
actions.filter((a) => a.paradigms.includes(query.paradigm))
actions.filter((a) => a.source === query.source)
connectors.filter((c) => c.type === query.type)
```

A repeated parameter arrives as an **array** from every query parser these routes
run behind, and an array is never `===` any string and never a member of
`paradigms[]`. So `?source=builtin&source=plugin` — a caller widening its filter,
or a UI serialising a multi-select the obvious way — answered **200 with zero
descriptors**. The designer palette reads that as "this deployment registers no
actions", which is a different statement from "no actions matched", and nothing
in the response distinguishes them. A structured `?type[$ne]=x` failed the same
way.

This is #7300/#6928's family but not its mechanism: nothing is coerced and no
value is invented — the filter is simply never satisfiable, and the emptiness is
indistinguishable from a genuinely empty registry.

All four filters now go through the shared `parseStringParam` that the same
file's runs branch already uses, so a non-string is refused in the house shape:
`400` `VALIDATION_FAILED` (ADR-0112) with a `details.fields[]` entry naming the
parameter and carrying ADR-0114's `invalid_type`. The parse runs ahead of the
service-capability probe, so the refusal does not vary by which automation
service a deployment mounts.

**Nothing that worked before changes.** Every *string* still filters exactly as
today, including one that names no live paradigm, source, category or type:
"no actions of that source" is a legitimate empty answer and stays one. Absent
and empty spellings still mean "no filter". The typed SDK
(`client.automation.listActions` / `listConnectors`) builds these with
`URLSearchParams.set`, so it cannot emit a refused value.

Repeated parameters are refused rather than read as an OR-filter: no caller
needs the widening today — the designer palette fetches `/automation/actions`
unfiltered and narrows by paradigm client-side, and the typed SDK's descriptor
filters are single strings — so accepting one would be inventing a wire
capability nothing asks for, on the route where a wrong empty answer is hardest
to notice.

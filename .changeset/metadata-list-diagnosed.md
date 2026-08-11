---
"@objectstack/spec": minor
"@objectstack/metadata": minor
"@objectstack/mcp": minor
---

feat(spec,metadata,mcp): let a plural metadata read say it is known-partial (#6504)

`IMetadataService.list(type)` returns an array whether every loader answered or
one of them was down. A consumer receiving a short list therefore had no way to
ask whether it was short because that is all anyone declared, or because a
loader was unreachable — the #5840 / PR #6051 defect on the plural read.

The verdict already existed and was already being thrown away.
`MetadataManager.readListUncached()` has computed a `degraded` flag since #5184,
and `list()` spent it entirely on picking a cache TTL. This is sharper than the
singular case rather than merely analogous: `list` is the read whose answer
carries a **count**, and a consumer restating `items.length` as "this
environment contains N items" makes a positive, numeric claim out of a read that
partly did not happen.

**New optional contract member — `listDiagnosed?(type)`.** Returns
`{ items, degraded, errors }`, the plural counterpart of `getDiagnosed`.
Optional for the same reason its singular twin is: an implementation that
predates it cannot report the distinction, so a consumer probes for it and falls
back to `list()`, which reports nothing degraded. `list()` itself is unchanged
in every direction — same items, same array instance, same best-effort posture —
so no existing caller has to do anything.

`MetadataManager` implements it through the same cache entry and the same
single-flight slot `list()` uses, so asking for the verdict costs no extra
loader walk and the two members cannot drift.

**MCP consumers, classified individually** (PR #6051's discipline, not a blanket
switch):

- `objectstack://objects` **mis-described**, and its degraded body changes. It
  rendered `{ objects, totalCount }`, and during an outage `totalCount` was
  simply false. A healthy read is byte-identical to before. A degraded read now
  serves the same `objects` — the reachable set is still the most useful true
  thing here — with `totalCount` **absent** and `partial: true`,
  `returnedCount`, `warning`, plus the `code: 'SERVICE_UNAVAILABLE'` / `status:
  503` envelope the sibling `objectstack://objects/{objectName}` resource
  already carries. Dropping the key rather than reporting a smaller number is
  the point: a client reading `body.totalCount` now gets `undefined`, where a
  plausible-looking integer would have been believed.
- the `agent_prompt` sibling **skill bridge** is a snapshot and its output is
  unchanged. It publishes no count to any client, so a degraded read costs it
  silently-unregistered prompts instead of a false statement; the verdict goes
  to the operator as a `warn` naming the loader, the fact that the skills are
  missing rather than undeclared, and that the stdio transport's snapshot stays
  short until restart while the HTTP transport self-heals.

If you consume `objectstack://objects` and read `totalCount` unconditionally,
branch on `partial` (or on the key's absence) before treating any count from
this resource as a total.

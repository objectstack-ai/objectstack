---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): SeedLoader asks the registry for a `name` column before probing it — no more hundreds of provoked `INVALID_FILTER` refusals per seeded boot (#9071)

`SeedLoaderService.resolveFromDatabase()` resolves a reference authored as a
natural key by walking a probe chain: the target dataset's declared
`externalId`, then the historical `name` default, then the internal `id`. The
`name` leg was spelled **unconditionally** — including on objects that have no
`name` column at all.

On those objects the probe is not a cheap miss. The driver **refuses** it:

```
[sql-driver] INVALID_FILTER — Filter on 'name' names a column that object
'crm_contact' has no column for, so the predicate never ran.
ERROR Find operation failed {"object":"crm_contact", …}
```

and it is right to. A predicate naming a column the object does not have never
ran, so answering "no rows" would be a lie (ADR-0110 D3 — a miss and a fault are
different facts). One refusal is raised per reference value, per pass: a real
`serve` boot with a 342-row seed emitted **hundreds of ERROR-level
`Find operation failed` lines**, on every seeded boot and every per-organization
replay, each reading exactly like a real failure that everyone downstream has to
learn to ignore.

**The fix is on the asking side, not the answering side.** The driver's refusal
is untouched — not caught more quietly, not downgraded, not filtered out of the
log. Instead the loader now asks the metadata registry whether the target
declares a `name` column, through the same `resolveObjectDefinition` resolver it
already builds the reference graph from (metadata service first, then the
engine's own schema registry), and drops the leg when the answer is no.

Which probe answers cannot change: on an object with no `name` column that leg
could only ever throw, never match. The guard covers the leg in **both** of its
positions — the fallback, and the first position it occupies when a referenced
target carries no dataset in this load and keeps the metadata-level `name`
default.

**An unknown is not a denial.** When neither the metadata service nor the
engine's schema registry can describe the object, the leg is kept — the
historical behaviour — rather than narrowed on a fact nobody established. The
answer is memoised per `load` (the question is asked once per unresolved
reference value, hundreds per boot) and re-asked on the next one, since a
publish between two loads can add the very column it is about.

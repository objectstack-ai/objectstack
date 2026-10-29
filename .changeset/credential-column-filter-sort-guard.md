---
'@objectstack/objectql': patch
---

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime read door: the engine stops EVALUATING a `password` / `secret` column in a non-system caller's filter or sort position, a column every generic read already masks, and the remedy is a change to the caller's query, never to anyone's metadata. No exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only); the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing), shipped as `patch`: nothing a metadata author writes changes (`Metadata-protocol: none`), so the level follows the kind, and the banner and the ADR-0087 disposition stay.

Hardening (ADR-0100): the engine's credential-column guard now covers filter and sort keys, not only aggregates. A `password` or `secret` field was already refused as a group-by key or a min / max operand; the same refusal now covers every position that evaluates the stored value.

**FROM.** For every caller except a system context, on `find`, `findOne`, `count`, `aggregate` and predicate `update` / `delete`, and so on every door that reaches them with a caller context (the REST data routes, the MCP bridges, flows, hooks' `ctx.api`, plugin routes):

- A `where` / `filter` predicate on a `password` or `secret` field was evaluated, including a `{ "$field": … }` comparand, a per-aggregation `filter`, an `expand` entry's own `where` / `orderBy`, and a nested-relation condition on a related object's credential field.
- An `orderBy` key on such a field was admitted.
- A search scanned such a field when the object listed it in `searchableFields`.
- An import in `upsert` or `update` mode whose `matchFields` names such a field looked rows up by that field.

**TO.**

- Each of those filter and sort positions is refused `400 INVALID_FIELD`, the same ADR-0112 envelope as the aggregate refusal (with `field`, `object` and `param` naming the position), before any driver is asked. The group-by and min / max refusals are unchanged.
- A has-a-value check stays accepted: `{ "$null": … }`, `{ "$exists": … }`, `{ "$empty": … }`, or equality with `null`.
- A search never scans a credential column, even one an object lists in `searchableFields`.
- An import whose `matchFields` names such a field now meets the same refusal in its match lookup: each row that reaches the lookup is reported failed with that refusal and is not written.
- A system context is not bound, so the server's own credential lookups are unchanged.

**Fix.** A caller that sorted or filtered on a `password` / `secret` field now receives `400 INVALID_FIELD`: sort or filter by another field, or use a has-a-value check. An import that matched on such a field matches on another field.

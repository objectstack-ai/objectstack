---
'@objectstack/service-settings': patch
'@objectstack/metadata': patch
---

Make the settings engine facade and the metadata database loader bind the row
they resolved, not a row the payload names

Two ingresses resolved an authoritative row id and then folded it into the
write payload with the **losing** spread order — `{ id, ...data }` — so a
caller-supplied `data.id` spread over the id the ingress had just resolved and
silently retargeted the write:

- `wrapEngineAsSettingsEngine`'s by-id `update` branch
  (`@objectstack/service-settings`), whose id comes from the caller's
  `where.id`.
- `DatabaseLoader._update` (`@objectstack/metadata`), whose id arrives as a
  separate parameter every caller resolves first (`existing.id`, from the read
  immediately above).

Both now spell it `{ ...data, id }` — the operation's id **after** the spread,
so it wins. That is the convention the repo's other two ingresses already
document: `rest-server.ts`'s batch update arm ("the operation's id AFTER the
spread, so it wins") and `protocol.updateData`'s #6479 fix
(`{ ...request.data, id: request.id }`).

**No wrong write is known to have been reachable.** Both sites' current callers
build fresh field literals and never put an `id` inside `data`, so this is
hardening a fragile pattern rather than repairing a measured defect. What makes
it worth the three characters is that neither site can be caught downstream:
both pass **no `where`** to the engine, so the payload is the only id the engine
ever sees, and the engine's conflicting-id refusal (`UPDATE_ID_MISMATCH`, 400)
needs two disagreeing declarations before it can fire. The fold is the entire
trust boundary at both sites, and it is one refactor — a caller handing back a
row copy, and rows carry `id` — from the #6479 shape.

Both are pinned with a payload whose `id` names a **different** row than the
one the ingress resolved, asserting the resolved row is still the row bound. A
pin exercising a payload without an `id` would have passed against both
spellings. The doubles answer "which row does this bind?" with the producer's
own `assertEngineUpdateDispatch`, so they cannot be kinder about it than a
running server.

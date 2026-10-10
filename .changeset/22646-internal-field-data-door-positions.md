---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

fix(objectql,metadata-protocol)!: the data door honours a field's `internal: true` in its filter, sort, group-by, aggregate, per-aggregation-filter, `$search` and one-level `$expand` positions, not only the row (#22646)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime read door — the generic data door stops EVALUATING a field whose existing `internal: true` declaration already withholds it from every row, and the remedy is the declaration the author already wrote, never a rewrite of anyone's code or metadata. No exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only); both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A field declared `internal: true` is withheld from every generic exit (#21197): the engine omits it from every row, select-named included. The ROW position honoured that; the generic data door's EVALUATE positions did not, so a value the platform withholds from rows could still be learned through a position that answers by its stored value.

**FROM.** On `origin/main`, for a member holding read and for an administrator alike, on the list and query data routes (`GET /api/v1/data/:object`, `POST /api/v1/data/:object/query`):

- A **filter** naming such a field was admitted — the predicate reached the driver, so the row came back only when the guess matched: a confirmation oracle over a withheld value.
- A **sort** by such a field was admitted — the order leaks the comparative stored value.
- A **group-by** of, or an **aggregate operand** over, such a field was refused by the engine, but as an undeclared `500 INTERNAL_ERROR` (a bare `Error` with no `code` or `status`), not a declared refusal.
- A **per-aggregation filter** (`aggregations[].filter`) naming it, and a **filter beside an aggregation**, were admitted — the same oracle at a second filter position.
- A **`$search`** whose resolved set included such a field (a non-hidden `internal` text column enters the auto-default) scanned it — a cross-field substring match that confirms a guessed prefix.
- A one-level **`$expand`**'s own `where` / `orderBy` on the TARGET object's `internal` field was admitted into the expansion sub-read — the expanded record's presence is an oracle on the related row.

**TO.** Each evaluate position is refused `400 INVALID_FIELD`, a declared ADR-0112 envelope naming the object and the field, before the engine is asked:

- Filter, sort, group-by, aggregate operand, per-aggregation filter and a one-level expand's own filter/sort are refused at the generic data door (`@objectstack/metadata-protocol`), after the field-existence gates, in the shape and envelope of the stored-metadata body/hash family one axis over.
- The engine's `aggregate()` refusal (`rejectCredentialAggregation`) now carries the `INVALID_FIELD` / 400 envelope instead of the bare `Error`, so the group-by and aggregate-operand positions answer a declared `400` rather than a `500` — and the `secret` / `password` case that shared that bare `Error` is upgraded with it.
- A `$search` never scans an `internal: true` column: the field is dropped from the set the engine's search expansion resolves over (a withhold, like the auto-default's `hidden` / credential-type exclusions), and an explicit `$searchFields` naming one is refused `400 INVALID_FIELD` at the door rather than silently widened back to the default set.

**Bindings.**

- **Every caller.** The refusal is at the generic data door and takes no user, so an administrator is refused exactly as a member is (#21197). There is no system carve-out at the door.
- **The engine's privileged consumers are untouched.** The API-key verifier's `where: { key: <hash> }` lookup, the share-link / SCIM / approval-token lookups — all call the engine directly under a system context and never pass the generic data door, so authentication keeps working, exactly as #7823 kept the engine's write results whole while the generic-data-path ingress stripped them.
- **One flag reader.** Every position judges `collectInternalReadFields` (engine) or its byte-identical `@objectstack/core` twin `collectInternalWriteResponseFields` (the door, which sits below objectql), never a second list.
- **Unchanged.** An ordinary field in every position is served as before; an object that merely has an `internal` field is served for every other field.

**Scope.** Target-OBJECT exposure through `$expand` is a separate axis (#22661); the cross-object search sweep (`searchAll`) is #22640's region and inherits the engine's search-set withholding through `engine.find` without a change to its own code.

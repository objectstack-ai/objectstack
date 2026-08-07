---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

metadata: `getDiagnosed` — a metadata read that FAILED stops arriving as "nobody declared this"

`MetadataManager.loadDiagnosed` computes the ADR-0110 D3 verdict (a MISS and an OUTAGE
are different facts with opposite security meanings) and `get()` discarded it two hops
later: `load()` kept only `.data`, `get()` turned that `null` into `undefined`. Every
consumer of `get()` therefore received one `undefined` for two opposite facts and could
not have told them apart even if it had wanted to.

**New read.** `MetadataManager.getDiagnosed(type, name)` returns
`{ data, degraded, errors }` — the registry-first counterpart of `loadDiagnosed`, declared
as an optional member of `IMetadataService`. A registry hit is never degraded (it
consulted no loader); a clean miss is never degraded (every loader answered).

**`get()` is unchanged — zero breaking.** Same signature, same answer, same behaviour for
every existing caller, including the microtask-level ordering `register()`'s watchers
depend on. Only callers that ASK for the verdict pay for it. Making `get()` throw on
`degraded` was deliberately not done: the boot path degrades on purpose.

**Consumers switched**, each with a disposition argued for its own context rather than one
blanket rule:

- `getMetaItem` / `getMetaItemCached` — a degraded MetadataService read with nothing in
  the registry now raises `503 SERVICE_UNAVAILABLE` instead of falling through to
  `404 RESOURCE_NOT_FOUND`. This is the half that made the existing `#5532` comment ("
  reaching here now means a real miss") untrue.
- `getMetaItemLayered` — the `code` layer joins the rule its `overlay` layer already
  followed. `code: null` is a positive claim, and `lockSource = code ?? overlay ?? {}`
  derives from it, so an outage could render an item the packager locked
  (`_lock: 'full'`) as `editable: true, deletable: true`.
- `ObjectQLPlugin`'s `object` metadata-event refresh — logs `warn` naming the consequence
  (the registry keeps the previous definition; nothing retries) and the fix, instead of
  `debug` "metadata service has no fresh body". `warn` and not `error` because the write
  already landed; only a re-read failed.

Hosts whose `metadata` slot is a shim that predates `getDiagnosed` are read as
"not degraded" — exactly what they could express before — so their behaviour is unchanged.

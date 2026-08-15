---
"@objectstack/service-datasource": minor
"@objectstack/runtime": minor
"@objectstack/mcp": minor
---

fix(runtime,mcp,service-datasource): the #6504 consumer sweep — three list consumers stop making claims a known-partial read cannot support (#6504)

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface is
added, renamed, retired or tombstoned. Two package-local host-wiring interfaces
gain OPTIONAL members (`DatasourceAdminServiceConfig.countBoundObjectsDiagnosed`,
`McpDataBridge.listObjectsDiagnosed`); `packages/spec` is untouched, since
`IMetadataService.listDiagnosed` — the contract this consumes — landed in PR
#7721. -->

`IMetadataService.listDiagnosed?(type)` (PR #7721) lets a plural read say whether
its answer can be trusted as complete. This is the consumer half: the callers
that were restating a possibly-short listing as a fact about the environment.

Each consumer was qualified individually, per PR #6051's discipline, and most
were left alone — a caller publishing a snapshot with no count has nothing to
mis-state. Three make a claim, and each now withholds exactly that claim while
still serving everything it could read:

- **`removeDatasource` no longer deletes on a bound-object count it could not
  take completely.** The guard `if (bound > 0) throw` is the only thing standing
  in front of an irreversible delete that also unbinds the datasource's secret,
  and its input is derived from the metadata service's object listing. During a
  loader outage that listing goes silently short, and the worst value is the
  benign one: `0` reads exactly like "nothing is bound", so the guard OPENED.
  It now refuses with `SERVICE_UNAVAILABLE` / 503 — a dependency outage the
  operator can retry, not a client error — and the record, its credential and
  its pool all survive.
- **The MCP `list_objects` tool stops publishing `totalCount` on a known-partial
  listing.** This is the same claim PR #7721 removed from the
  `objectstack://objects` resource, on the other MCP primitive: same payload
  shape, different door, never covered. A degraded read now serves the same
  objects with `totalCount` **absent** and `partial` / `returnedCount` /
  `warning` plus the 503 envelope in its place, so a client reading the total
  gets `undefined` rather than a believable wrong integer. Both bridges
  implement it — stdio (`@objectstack/mcp`) and HTTP (`@objectstack/runtime`) —
  because a completeness claim must not depend on which transport a client
  connected over.
- **The ADR-0015 §5.2 boot gate stops announcing an all-clear over a sweep it
  could not complete.** It validated whatever `listObjects()` returned and then
  logged *all federated objects match their remote schema*, with a count.
  Federated objects behind an unreadable loader were never validated, so
  `onMismatch: 'fail'` could not have fired for them. The gate now warns that
  the swept set was incomplete and names what it did validate. ⛔ It does **not**
  abort boot on a degraded metadata read: turning a transient outage into a
  refusal to start would be a new failure mode bought with a diagnosis fix.

Every new member is optional in the same way `listDiagnosed` itself is: a host
whose metadata service predates the verdict behaves exactly as it did before,
and a service without it reports nothing degraded — precisely what it could
express.

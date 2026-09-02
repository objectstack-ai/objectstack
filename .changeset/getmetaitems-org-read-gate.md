---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): `getMetaItems` applies the registry read gate itself, so a sweep that reads more than one type per request is scoped per type (#14683)

`getMetaItems` applied no organization gate of its own: whatever `organizationId`
arrived was spent on whatever `type` arrived. The scope of a metadata sweep was
therefore decided per type **by the caller** — which a request carrying one
organization can only get right when it sweeps **one** type. It now resolves
`organizationIdForMetaRead(request.type, request.organizationId)` once, after the
canonical type fold, and both the active-overlay read and the `previewDrafts`
read spend that one resolution.

Three live callers sweep more than one type and could not have been right:

- `getMetaDiagnostics` with no `type` — `targetTypes` is the whole registry, the
  five `allowOrgOverride: true` types and every other declared type together,
  under one request-level organization.
- `findReferencesToMeta` — `request.type` is the **target**; the organization is
  spent on `matcher.fromType`, the **sources**, so the target's own registry flag
  says nothing about the types actually read.
- the runtime's package export sweep (`assemblePackageManifest`) — every plural
  key of `PLURAL_TO_SINGULAR`, with one raw active organization.

**The harm class is resurrection, not concealment**, and which one it is decides
that the registry-gated predicate is the right instrument.
`SysMetadataRepository.history()` filters `organization_id` by strict equality,
so naming the tenant *there* hides an `allowOrgOverride: false` type's rows. On
this path the two `queryByOrg` reads are UNIONed, so naming it can only **add** —
and what it adds are the pre-#6190 phantoms: org-scoped rows of types with no
per-org read channel, which `loadMetaFromDb` walks past and
`reportUnhydratableOrgScopedRows` exists to warn about. Read back, they surface
in the admin "Used by" panel and the Studio governance directory, inside a
clearance rendered before a destructive action — where a resurrected row is worse
than an omission because it reads as evidence.

**Why `minor` and not `patch`.** No export is added or removed, no declared type
narrows, and `GetMetaItemsRequest` still accepts `organizationId?: string` — so
this is not the `**BREAKING**` published-type narrowing shape. But it is also not
the patch shape: an envelope on an existing refusal or an accept-set widening
leaves what a successful read *returns* untouched, and this changes it. On a
deployment carrying pre-#6190 phantom rows, a session with an active organization
gets **fewer rows** back from published read doors that pass the raw active
organization — the dispatcher's `GET /metadata/:type` list and the package
export/manifest doors. A published read door's answer changing without an export
change is the `minor` precedent, and this is its row-set analogue. ⛔ Not "only a
refactor of where the predicate lives": the predicate's new position changes which
rows two published doors serve, and that is the reason for the level.

**Callers that already gate are unaffected, and that is proved rather than
asserted.** `organizationIdForMetaRead` answers either its argument or
`undefined`, so a second application over the same type is a no-op; the load-
bearing half is that it *is* the same type. The REST `GET /meta/:type` list door
gates on `canonicalMetaUrlType(req.params.type)` and passes the raw segment, which
`canonicalizeMetaRequestType` folds through the identical map — the identical
string. The other four `organizationIdForMetaRead` call sites in `rest-server.ts`
reach `getMetaItemLayered` / `getMetaItem` / `historyMetaItem` / `diffMetaItem`
and never this method. `get-meta-items-org-read-gate.test.ts` §3 measures both
halves over the complete accepted-spelling population (61 spellings, derived from
`META_URL_TO_SINGULAR` unioned with the registry) rather than a hand-listed
sample.

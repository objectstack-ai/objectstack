---
'@objectstack/runtime': patch
---

feat(runtime): `/automation` names a flow or a connector instance by its namespace or `_env` (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which flow or connector instance an addressed `/automation` path reaches and what a few unserved paths answer; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The flow doors take an installed namespace, or `_env`, in front of the flow's name: `GET`/`PUT`/`DELETE /api/v1/automation/:ns/:name`, `POST …/:ns/:name/trigger|toggle|clone`, `GET …/:ns/:name/runs[/:runId[/screen]]`, `POST …/:ns/:name/runs/:runId/resume|cancel|restore-suspension`, and the legacy `POST /api/v1/automation/trigger/:ns/:name`. The connection door takes one in front of the instance: `GET`/`POST`/`DELETE /api/v1/automation/connectors/:ns/:name/connection`. Each addressed path is served exactly as its bare path, behind the same gates, which judge the bare shape before the address is weighed.

- The address is served only when the bare name resolves to the package the namespace names (the engine's own resolver, `resolvePackageScopedName`), because the engine arms one flow per bare name. A namespace whose package holds no such item answers `404` naming the namespace when nothing holds it, and `409 RESOURCE_CONFLICT` naming the holders when another package does. A namespace two packages co-own, both holding the name, answers `409` naming both. A name two packages hold has no served door, bare or addressed: the engine arms no flow under it, so its address answers the same `409` as its bare path.
- `_env` names the environment's own flow or instance; a name only packages hold answers `409` naming them.
- A qualifier followed by one of the door's own literals (`actions`, `_status`, `connectors`, `hooks`, `trigger`) is no address and no route: `/automation/_env/actions` and `/automation/<namespace>/hooks/…` are declined, never the catalog or another door. The bare literal routes (`GET /automation/actions`, `GET /automation/_status`) are never the by-name `409`, even when packages hold a flow of that name.
- A sub-resource segment in the name position keeps its bare route: `/automation/crm/runs` is still the runs of the flow `crm`, though `crm` is an installed namespace. The literals (`actions`, `connectors`, `_status`, `hooks`, `trigger`, `credential-refs`, `oauth`) are never read as a namespace. A first segment that is no installed namespace reads as the bare path, which is unchanged.
- The qualified inbound hook is not in this change; `/automation/hooks/:flowName/:hookId` is unchanged.

**BREAKING**, four answers (first-party count: 0 for each; no first-party client sends any of these paths, and two packages holding one name is a state an install makes, not a spelling any first-party code sends):

- **A bare flow or connector name two packages hold** now answers `409 RESOURCE_CONFLICT` naming both on its by-name doors (read, run, legacy trigger, toggle, runs, connection). The engine refuses to arm such a name, so before, each door answered as for a name it holds no flow under (the read `404`, the run the engine's refusal naming the holders), and the connection door handed the name to the automation service unqualified.
- **A three-segment legacy trigger whose middle segment is not an address** (`POST /automation/trigger/:x/:y`) is no route, and the domain now declines it behind its gates. Only `POST`: another verb at that depth is the flow `trigger`'s (`GET /automation/trigger/runs/:runId`), served as before. On the catch-all host (`createHonoApp`) the domain ran the flow `:x` and ignored `:y`; now the host answers its own `404`. On the mounted host (the dispatcher plugin on the standalone server) the transport answered `404 ENDPOINT_NOT_FOUND`; now the dispatcher answers its no-route `404 ROUTE_NOT_FOUND`.
- **Two- and three-segment paths no route serves** (`/automation/:x/:y` with `:x` no namespace, `/automation/:x/:y/trigger|toggle|clone|runs`, `/automation/connectors/:x/:y/connection`) now reach the domain through the addressed mounts and are declined: the mounted host answers `404 ROUTE_NOT_FOUND` where the transport answered `404 ENDPOINT_NOT_FOUND`, and an anonymous caller gets `401`, as on every `/automation` path.
- **A served shape under a verb it is not served by** answers the domain's `405` with the verbs the shape is served under (`Allow: GET` for the runs list, `Allow: POST` for the run, `Allow: GET, PUT, DELETE` for a flow).
  - Mounted host: the two-segment shapes (for example `PUT /automation/:name/runs`, `GET /automation/:name/trigger`) are now decided by the domain under every verb, so the generic addressed mounts never show up in an `Allow`. Anonymous callers get `401`. A signed-in caller gets the same `Allow` the transport gave, now in the dispatcher's envelope. Other depths keep the transport's `405`.
  - Catch-all host: every served shape, at every depth (one to four segments), answered `404` under a verb it is not served by; it now answers this `405`.

The fix: FROM `trigger/:x/:y` TO `trigger/:y` (bare) or `trigger/<namespace>/:y` (addressed). FROM a flow or connector name two packages hold TO one holder: rename or remove the other package's flow or instance. Until then the name has no served door, bare or addressed, because the engine arms no flow under it; its address answers the same `409`. FROM a `405`'s old `404` on the catch-all host TO the verb its `Allow` names.

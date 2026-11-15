---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

fix(objectql,metadata-protocol)!: a stored row bound to a package lives in that package's own registry slot, so each package's address serves its own row in every save order, before and after a restart (ADR-0150 D3/D4)

Clause-②: yes (narrowing) — one served answer goes away: an action that two packages hold only as stored rows was served by the read naming no package after a restart (the row hydrated last); it now refuses `409 RESOURCE_CONFLICT` naming both, as every other type the registry reads by package already did (#32607). The widening is on `SchemaRegistry`, exported from `@objectstack/objectql`: `registerItem` takes an optional fifth argument `{ storedRowPackage }`, and one new public method `removePackageOverlaySlots(type, name, member, select)`; and four reads that answered a shipped item, a 404 or a 409 now answer the address's own stored row (below).
Metadata-protocol: semantic
Skills-docs: none — `skills/**` and `content/docs/**` teach no reading of a name two packages each store a row of (grepped `?package=`, `.custom`, `409`: the hits are the pair's save door, a flow's secret refusal and a permission grant), so no taught sentence moves; the read naming no package keeps its `409` and its `?package=` remedy.

<!-- adr-0087: registered stored-row-own-package-slot -->

**BREAKING** for a reader of an action that two packages hold only as stored rows, by the read naming no package (`GET /api/v1/meta/action/NAME`), after a restart: it refused before the restart and served the row hydrated last after it; it now refuses `409 RESOURCE_CONFLICT` naming both packages, before and after. The fix: read each package's action by its package (`?package=ID`).

The registry kept ONE slot per name for a stored row (`registerItem` with no package), so the row saved or hydrated last took it. Each stored row of a type the registry reads by package (action, tool, agent, skill, webhook, api, email template, picklist, mapping, dataset; flow and permission keep their own slot rules) that is bound to a package — its own, or its `.custom` pair's by the pair-row rule — now lives in that package's own overlay slot, beside the package's code artifact, which it never overwrites.

- **#33127 — two packages ship a name and each stores its own row.** At boot (`loadMetaFromDb`) the row hydrated last took the name's slot: that package's registry item and `?package=` read answered its row, the other package's answered its shipped item, which package by row order (tool, webhook, agent, skill measured). Each package now answers its own row in every registration and row order; the read naming no package still refuses `409` naming both.
- **#32663 — the writer's registry item.** After alpha then beta saved a row of one name, both replicas' registry items answered `[null, beta's row]` at the two packages (the mirror in the other order) while the exact reads, row-served, answered each package's own row. The registry now agrees with the exact reads on the writer and on the peer (action, tool, email template). A `dashboard` is converged by name, unchanged.
- **#32662 — a pair address of a name held only as stored rows.** `?package=ID.custom` answered `404` for both packages before a restart and, after it, `200` for the row hydrated last and `409` naming one package for the other (dashboard, tool, action). Each pair address now answers its base package's row, before and after.
- **#32662 scope note (b).** A package's row beside its own pair's undeclared row: the read naming no package served the pair's row when it was saved first while `/published` served the package's own row. Both now serve the package's own row in either order.
- **#32900.** A module's locale member stored in its App's pair (declaring the module) beside a package-less row of the same locale: the module's registry item at that locale followed the row order. It now answers the module's own pair row in both orders; the install and seal answers are unchanged.

Unchanged, pinned as CONTROLs: a name one package holds (its row in its slot, its exact read and its read naming no package); two packages with one stored row (the other keeps its shipped item); a package-less row (it keeps the bare slot); the read naming no package of a two-holder name (`409` naming both).

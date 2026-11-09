---
'@objectstack/objectql': minor
---

feat(objectql): two packages of two namespaces may each ship an agent or a skill of the same name (ADR-0150 child B)

Clause-②: yes (widening) — the engine's package door (`SchemaRegistry.installPackage`), its item seam (`SchemaRegistry.registerItem`) and the cold boot's holder seal (`SchemaRegistry.sealBareNameHolders`) accept, for an agent and a skill, a second package holder they refused before: one that declares a namespace other than the holder's. Nothing is narrowed.
Metadata-protocol: added

The bare-name one-holder rule (`bare-name-one-holder.ts`) has narrowed for `agent` and `skill` from one package holder per deployment to one per namespace (ADR-0150 D2, D9). Their by-name readers now answer by `(package, name)`: `GET /meta/agent/NAME` and `GET /meta/skill/NAME` refuse `409 RESOURCE_CONFLICT` naming every holder when two packages hold the name, `?package=ID` serves that package's own, and the MCP prompt list names each skill by its face (`NAMESPACE-NAME`). So a package no longer has to rename an agent or a skill because a package of another namespace already ships one of that name.

Unchanged, and still refused with the same `422 NAMESPACE_CONFLICT` envelope and sentence:

- a second package of the SAME namespace (a co-owner) holding the name;
- a package that declares no namespace, beside any other holder of the name, and any holder beside it;
- two packages of one shareable namespace (`base`, `system`, `sys`) holding the name;
- a built-in name.

Every other covered type (picklist, mapping, dataset, API, object-less action, function, flow, webhook, connector, email template, tool) keeps one package holder per deployment. Each narrows in its own change by joining `NAMESPACE_SCOPED_BARE_NAME_TYPES`, the per-type switch this change adds beside the predicate `bareNameHoldersMeet` (both internal to the engine; no export of the package changes).

`os migrate stored-references` no longer lists two namespaces' holders of one agent or skill name among the sealed clashes: they are not a clash.

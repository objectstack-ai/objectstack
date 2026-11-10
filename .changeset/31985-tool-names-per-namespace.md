---
'@objectstack/objectql': minor
---

feat(objectql): two packages of two namespaces may each ship a tool of the same name (ADR-0150 child B)

Clause-②: yes (widening) — the engine's package door (`SchemaRegistry.installPackage`), its item seam (`SchemaRegistry.registerItem`) and the cold boot's holder seal (`SchemaRegistry.sealBareNameHolders`) accept, for a tool, a second package holder they refused before: one that declares a namespace other than the holder's. Nothing is narrowed.
Metadata-protocol: added

The bare-name one-holder rule (`bare-name-one-holder.ts`) has narrowed for `tool` from one package holder per deployment to one per namespace (ADR-0150 D2, D9), as it did for `agent` and `skill`. A package's `tool` record has one by-name reader, `GET /meta/tool/NAME`, which already answers by `(package, name)`: it refuses `409 RESOURCE_CONFLICT` naming every holder when two packages hold the name, and `?package=ID` and `/meta/tool/NAMESPACE/NAME` serve that package's own. So a package no longer has to rename a tool because a package of another namespace already ships one of that name.

Unchanged, and still refused with the same `422 NAMESPACE_CONFLICT` envelope and sentence:

- a second package of the SAME namespace (a co-owner) holding the name;
- a package that declares no namespace, beside any other holder of the name, and any holder beside it;
- two packages of one shareable namespace (`base`, `system`, `sys`) holding the name;
- a built-in name (none for a tool: the platform requests no tool record by name).

Every other covered type except agent and skill (picklist, mapping, dataset, API, object-less action, function, flow, webhook, connector, email template) keeps one package holder per deployment.

`os migrate stored-references` no longer lists two namespaces' holders of one tool name among the sealed clashes: they are not a clash.

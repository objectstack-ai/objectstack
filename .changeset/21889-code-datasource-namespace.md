---
'@objectstack/runtime': patch
'@objectstack/service-datasource': patch
---

An import over a code-defined datasource is held to the namespace of the package that declares it (ADR-0028), and the draft door answers the prefixed name (#21889).

Clause-②: no

- **Before.** `POST /api/v1/datasources/:name/external/tables/:remote/import` with an explicit `name` that carried no namespace prefix answered `201` and saved an unprefixed federated object, and `POST …/external/tables/:remote/draft` answered the bare remote table name with a `TODO(namespace)` note. Measured on the showcase's `showcase_external` under `objectstack dev` and `objectstack start`.
- **`@objectstack/runtime`.** `AppPlugin` registers each code-defined datasource through `applyProtection` with the id and version of the package body that declares it, so the item carries `_packageId`, `_packageVersion` and `_provenance: 'package'`. On an ADR-0130 `packages[]` artifact each datasource takes its own body's id, never the artifact's top-level manifest id. A top-level datasource that no body declares keeps its registration under the artifact's own id, and a warning names it.
- **`@objectstack/service-datasource`.** The federation service reads the datasource's package record from the engine registry (`registry.getPackage` on the `objectql` service), the store the runtime publish gate reads for the same check. It used to ask the `metadata` service, which holds no package records in any composition, so no datasource resolved a namespace. The package id still comes only from the stamped `_packageId`.
- **What a caller sees now.** On a datasource whose package declares `manifest.namespace`, an unprefixed import `name` answers `400 EXTERNAL_IMPORT_ERROR` with ADR-0028's message, which names the prefixed name to use. An import with no `name` override saves the prefixed name the draft derives (for example `showcase_customers` instead of `customers`). `GET /api/v1/meta/datasource` lists the three provenance keys on a code-defined datasource; all three are declared on `DatasourceSchema`. The datasource admin list (`GET /api/v1/datasources`) is unchanged, and the admin door still refuses to edit or remove a code-defined datasource.
- **Unchanged.** A datasource that carries no `_packageId` (the host `default` is one) and a package that declares no namespace resolve no namespace, so their imports and drafts answer as before.

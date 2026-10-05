---
'@objectstack/service-datasource': patch
---

fix(service-datasource): `POST /api/v1/datasources/:name/external/validate` sees a federated object saved at runtime, with no restart (#21842)

Clause-②: no

- **What was wrong.** The federation service read its objects from the `metadata` service. That service holds a copy of the engine's object registry taken once at boot. `PUT /api/v1/meta/object/:name`, and the external-table import that saves through it, write `sys_metadata` and the engine registry, but never that copy. So after a federated object was saved at runtime, validate answered the code-defined objects only, and listed the saved one after a restart. An object re-saved at runtime was judged on its definition as it stood at boot.
- **What it reads now.** `ExternalDatasourceServicePlugin` reads objects (`listObjects` and `getObject`) from the engine's object registry on the `objectql` service, which is the registry the save writes through to. The registry is looked up when validation runs, not when the plugin starts. A saved or imported object is listed and judged on what was saved, the moment the save answers.
- **What does not move.** The comparison is unchanged: the same federation predicate, the same column and type checks, and datasource definitions read from the same place. On `objectstack dev` the boot validation gate sweeps the same objects with the same verdicts as before. No route's request or response shape changes, and no export is added.

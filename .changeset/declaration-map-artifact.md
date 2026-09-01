---
"@objectstack/spec": patch
---

New generated artifact `declaration-map/` (with `gen:declaration-map` / `check:declaration-map`, covered by `check:generated`): maps TS declaration names of authorable containers to their spec registry names — `ObjectSchemaBase` resolves to `data/Object`, `DatasourceSchema` to `data/Datasource` — composed from `json-schema.manifest/`, `export-origins/`, and a syntactic unwinding pass that recovers module-private base declarations. Repo-internal (not published to npm, like `export-origins/`); diff-side tooling reads it to decide whether a changed declaration is an authorable container.

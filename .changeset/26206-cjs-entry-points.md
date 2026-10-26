---
'@objectstack/metadata-core': patch
'@objectstack/service-cluster': patch
'create-objectstack': patch
---

fix(metadata-core,service-cluster,create-objectstack): ESM-only subpaths declare their types under `import`

Clause-②: no
Metadata-protocol: none

`@objectstack/metadata-core/testing`, `@objectstack/service-cluster/testing` and `create-objectstack/created-summary` are ESM-only, and now say so in their export maps: the subpath's `types` moved inside its `import` condition. `require()` of these subpaths already failed at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Before this change, TypeScript under `node16`/`nodenext` resolved their declarations for a CommonJS caller anyway (attw `CJSResolvesToESM`). Now it resolves them for `import` only, which is what Node does. ESM callers, and every resolution mode that reads the `import` condition, see no change. Each package's README now says the subpath is ESM-only.

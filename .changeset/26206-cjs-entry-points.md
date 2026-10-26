---
'@objectstack/driver-memory': patch
'@objectstack/metadata-core': patch
'@objectstack/service-cluster': patch
'create-objectstack': patch
---

fix(driver-memory,metadata-core,service-cluster,create-objectstack)!: ESM-only subpaths declare their types under `import`, and driver-memory retires its legacy default export

Clause-②: no (narrowing: retires `@objectstack/driver-memory#default` under ADR-0087's `runtime-export-retired` marker)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/driver-memory#default) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What retires is the default export of `@objectstack/driver-memory`'s published entry, a legacy `{ id, version, onEnable }` object that no kernel calls (the plugin contract is `init`/`start`/`destroy`). Nothing in this repository imports it, `ui/` and `examples/` included. The affected party is a TypeScript or JavaScript caller, and the compiler or the module loader at that import reports the break. -->

**BREAKING** (an export retirement), shipped as `patch`: no metadata protocol kind moves.

- **`@objectstack/driver-memory`.** The default export is gone; every named export stays. It was the pre-kernel plugin shape (`onEnable(context)`), which the kernel never calls. Under `require()` it also sat on a `.default` property, so a CommonJS caller never got it as the module value (attw `FalseExportDefault`).
- **`@objectstack/metadata-core/testing`, `@objectstack/service-cluster/testing`, `create-objectstack/created-summary`** are ESM-only, and now say so in their export maps: the subpath's `types` moved inside its `import` condition. `require()` of these subpaths already failed at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Before this change, TypeScript under `node16`/`nodenext` resolved their declarations for a CommonJS caller anyway (attw `CJSResolvesToESM`). Now it resolves them for `import` only, which is what Node does. ESM callers see no change. Each README says the subpath is ESM-only.

Migration, for a caller of the retired default export:

- FROM `default` (`import memoryDriver from '@objectstack/driver-memory'`) TO `InMemoryDriver`: construct `new InMemoryDriver(config)` and compose it through `DriverPlugin` from `@objectstack/runtime`.

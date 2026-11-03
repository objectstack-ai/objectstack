---
'@objectstack/cli': patch
---

fix(deps): the CLI takes the TypeScript compiler from `typescript` directly, so a fresh project's tree no longer carries `ts-morph`

Clause-②: no
Metadata-protocol: none

`@objectstack/cli` used `ts-morph` for one thing: the compiler namespace it re-exports (`ts`). It never used the `ts-morph` project API. The CLI now declares `typescript` `^6.0.3` as a runtime dependency. That is the range `@objectstack/lint` already declares, on the same 6.0 line that `ts-morph` 28 bundled. A project that installs the CLI therefore no longer resolves `ts-morph`, `@ts-morph/common` or the `minimatch` 10 copy that `@ts-morph/common` pulls in. The `minimatch` advisory GHSA-g3hv-75wg-m249 is fixed only in the 11 line, and `@ts-morph/common` 0.29.0, its newest release, still requires `^10`. Commands, exports and behaviour are unchanged.

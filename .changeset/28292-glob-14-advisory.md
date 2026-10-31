---
'@objectstack/metadata': patch
'@object-ui/cli': patch
---

fix(deps): `glob` goes to `^14.0.3`, past the GHSA-3g3m-2fjr-6pw4 fix in 14.0.2 (#28292)

Clause-②: no
Metadata-protocol: none

`@objectstack/metadata` and `@object-ui/cli` declare `glob` as a runtime dependency, so a downstream install now resolves the patched 14 line instead of an affected `13.0.6`. The call sites use only `glob` / `globSync` with `cwd`, `ignore`, `nodir` and `absolute`, which 14 keeps unchanged, and the Node engine floor is the same. `@object-ui/cli` also drops `@types/glob`, a deprecated stub: `glob` ships its own types. No API, behaviour or export changes.

---
'@objectstack/cli': patch
---

feat(cli): `os validate`, `os build` and `os lint` report `manifest.dependencies` ranges at build time (ADR-0141 D2, author side)

Clause-②: no
Metadata-protocol: none

The pre-install dependency check refuses a package whose `dependencies` range it cannot read, and judges a dependency the same artifact delivers for presence only. Until now the author first heard of either from someone else's environment: a `422 DEPENDENCY_MISSING` on install, or, for an in-artifact mismatch, never. The three authoring commands now judge every `dependencies` entry of the packages one install would deliver (each `packages[]` body of an ADR-0130 artifact, or the top-level manifest of a single package) with the install's own predicate, `checkDeclaredDependencies` from `@objectstack/metadata-core`. Nothing re-parses the range grammar.

- **Error**: a range outside the stated grammar on an entry the artifact does not deliver, and a `dependencies` that is not a `{ PACKAGE_ID: VERSION_RANGE }` record. The install refuses these whatever the target environment holds, so `os build` refusing them refuses nothing the platform would install.
- **Warning**: what the install admits. That is an entry naming a sibling package of the same artifact whose declared `manifest.version` the range does not admit (core bumped to `2.0.0` while a module still declares `^1.0.0`), a co-delivered entry whose range cannot be read, or a sibling whose version is not `MAJOR.MINOR.PATCH`.

Whether an out-of-artifact dependency is installed, and at what version, is still judged only at install. No build can see the target environment.

---
'@objectstack/cli': patch
---

fix(cli): `os build` runs the override write gate `os validate` runs (ADR-0146 D2, #28643)

Clause-②: no (narrowing)
Metadata-protocol: none

`os build` now calls `findOverrideDeclarationRefusals` beside the dependency-range check, the same walk over the publish door's own judge (`judgeOverrideWrite`) that `os validate`, the publish doors and the managed install ask. A stack carrying an `overrides` declaration the gate does not admit, or a dependent's item bearing a name a package in its dependency closure ships, is refused at build with the rows `os validate` prints (`NOT_OVERRIDABLE`, exit 1), and no artifact is written. Before, the build emitted that artifact and the managed install or a publish door refused it later with the same judge; what any door accepts is unchanged.

---
'@objectstack/cli': patch
---

fix(cli): `os build` runs the override write gate `os validate` runs (ADR-0146 D2, #28643)

Clause-②: no (narrowing)
Metadata-protocol: none

`os build` now calls `findOverrideDeclarationRefusals` beside the dependency-range check, the same walk over the publish door's own judge (`judgeOverrideWrite`) that `os validate`, the publish doors and the managed install ask. A stack carrying an `overrides` declaration the gate does not admit, or a dependent's item bearing a name a package in its dependency closure ships, is refused at build with the rows `os validate` prints (`NOT_OVERRIDABLE`, exit 1), and no artifact is written. Before, the build emitted that artifact and the managed install or a publish door refused it later with the same judge; what any door accepts is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `os build` now runs the override write gate `os validate`, the publish doors and the managed install already run, with the same judge (`judgeOverrideWrite`) and the same rows. An artifact it now refuses was already refused wherever it landed, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone; the remedy is the judge's own sentence (rename the item, or remove `overrides`). -->

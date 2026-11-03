---
'@objectstack/cli': patch
---

fix(cli): `os build` runs the `__c` extension-field reservation `os validate` runs (ADR-0146 D10, #28727)

Clause-②: no (narrowing)
Metadata-protocol: none

**BREAKING** accept-set narrowing at `os build` (`@objectstack/cli`): a package source whose field breaks the `__c` reservation now fails the build instead of emitting an artifact.

`os build` now calls `findExtensionFieldSuffixRefusals` beside the override write gate, the same walk over the save and install doors' own judge (`judgeExtensionFieldSuffix`) that `os validate`, the save, restore and publish doors and the marketplace install ask. A field spelled `__c` outside a base's paired `.custom` package, and an `objectExtensions[].fields` key of a `.custom` pair without the suffix, are refused at build with the rows `os validate` prints (`VALIDATION_ERROR`, exit 1), and nothing is written to `dist/`. Before, the build emitted that artifact and the marketplace install or a save or publish door refused it later with the same judge; what any of those doors accepts is unchanged. The fix is the judge's own sentence: rename a plain package's `x__c` field, or suffix the `.custom` extension field (`region` to `region__c`).

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `os build` now runs the `__c` extension-field reservation `os validate`, the save, restore and publish doors and the marketplace install already run, with the same judge (`judgeExtensionFieldSuffix`) and the same rows. An artifact it now refuses was already refused wherever it landed, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone; the remedy is the judge's own sentence (rename the field, or add the suffix). -->

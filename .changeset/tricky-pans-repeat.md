---
'@objectstack/cli': patch
---

`os i18n check --help` now names the whole set of translatable surfaces it reports on, derived from the detector's own source-kind taxonomy instead of a hand-typed sample.

The description named five kinds — `object/field/option/view/action` — against a fifteen-member `CoverageIssue['source']` union that `computeI18nCoverage` passes straight through from the shared extractor walk. A five-of-fifteen sample reads as a scope statement, not an illustration: someone who wanted app navigation or dashboard widgets checked was told the command does objects and fields, and either skipped the gate or went looking for a second tool that does not exist.

The phrase is now built from a `Record<CoverageIssue['source'], string>` map, so a new source kind is a compile error until it is named and is published in `--help` in the same edit.

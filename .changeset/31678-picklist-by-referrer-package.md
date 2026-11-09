---
'@objectstack/objectql': patch
'@objectstack/metadata': patch
---

fix(objectql)!: a field's picklist resolves from the package that declares the field, and the api endpoint index keeps one item per package and name

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored shape changes. What moves is which list a field's existing `picklist` name resolves to at runtime, through the package-scoped resolver ADR-0150 D3 rules, so there is nothing for a migration to rewrite; the D10 upgrade report lists each reference the narrowing refuses. -->

**BREAKING** for a field whose `picklist` names a list its own package cannot reach (`@objectstack/objectql`). A field's `picklist` now resolves from the package that declares the field: that package's own list, else the one package in its declared dependency closure (`manifest.dependencies`, plus the platform's `sys` packages) that holds the name, else nothing. Two kinds of reference that used to be served now are not:

- a field of a package whose list only an environment-authored item holds (one created in this environment, bound to no package);
- a field of a package whose list another package holds, when the field's package does not declare a dependency on it. Two packages shipped in one artifact are no exception: a sibling's list needs a declared dependency too.

Before, either field was served that list's options. After, it is served with no options and its values are refused, and the boot names each one in a warning instead of failing. A package installed after the boot that carries such a reference is refused at install, naming every holder. The fix is one line: add the package that holds the list to the field's package `manifest.dependencies`, or declare the list in the field's own package.

Unchanged: a field whose package holds the list, or depends on the package that holds it, is served exactly as before; a field written only by an environment-authored body (a tenant overlay, an object created in Studio) resolves the name environment-wide, as before; and a `picklistExtensions` entry still adds its options to the one list its `extend` names in the environment, whether or not its package depends on that list's package.

`@objectstack/metadata`: the api endpoint index reads its stored items one per package and name, so two packages' same-named api items are no longer collapsed into one before the matcher reads them. A package-less row under a name one package holds is that package's customization and keeps sharing its slot. While each api name has one package holder, every route answers as before.

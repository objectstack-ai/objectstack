---
'@objectstack/objectql': minor
---

fix(objectql)!: the registry fold judges an option patch against the options the object's owner declares, as the install door and `os validate` do (#28809)

Clause-②: yes (narrowing) — the object fold every read serves no longer applies a `fieldPatches` option patch whose option only an extension's `fields` redeclaration of the owner field declares; on `main` it applied such a patch when the redeclaring extension folded first. Nothing is widened, and no door's accept set moves.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is added or removed: the install door and `os validate` already refuse this patch, so a package that installs today never carries it. No package or example in this repository declares `fieldPatches`, so there is nothing for a migration to rewrite. -->

**BREAKING** narrowing in the object fold every read serves (`@objectstack/objectql`).

- **Before.** An extension can take an owner field over through `fields` and add an option the owner does not declare. A `fieldPatches` option patch of that added option was judged by the fold against the field as merged so far, so it applied whenever the redeclaring extension folded first (a lower `priority`, or the same extension). The install door and `os validate` judge the owner's own declaration and refused the same patch.
- **Now.** The fold asks the one judge (`fieldPatchTargetMisses`, `@objectstack/metadata-core`) of the owner's fields as the owner declares them, and applies only what it admits. A patch of an option the owner does not declare is not applied and is named once in the log, whatever the priorities, as any other unmatched patch is. Which fields a patch reaches is unchanged: the owner's own.
- **Residual, unchanged rule.** When an extension's redeclaration leaves out an option the owner declares, a patch of that option is admitted at all three readers, and the fold has no such option to relabel, so nothing of it applies and nothing is named while that extension is installed.
- **Who sees it.** A package whose extension patches an option that only an extension's `fields` redeclaration adds. Measured in this repository: none (`fieldPatches` appears in no package or example outside the implementing code and tests).

**The remedy.** Set that option's label where the option is declared: in the `fields` entry of the extension that redeclares the field.

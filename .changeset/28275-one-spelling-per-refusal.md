---
'@objectstack/metadata': patch
'@objectstack/objectql': patch
'@objectstack/cli': patch
---

refactor(metadata, objectql, cli): one spelling of the residual-picklist refusal, and one envelope for two registration refusals

Clause-②: yes (widening)
Metadata-protocol: none

Nothing a stack can declare is refused or accepted differently, and every refusal keeps its code, status and words byte for byte. What moves is where each judgement is written, so the doors that give the same answer read it from one place.

- **New subpath `@objectstack/metadata/picklist-references`.** It exports `unreferencedResidualPicklists(residual, bodies)`: given a composed stack's residual (what `unclaimedTopLevel` answers) and its package bodies, it returns every top-level picklist that no package body declares and no object field the engine registers names, each with its location and words, plus the one plural sentence for all of them, or `undefined` when there is none. It also exports the manifest picklist walk the engine already used (`collectManifestPicklistReferences`, `collectPicklistReferences`, `collectManifestPicklistNames`, `collectManifestPicklistExtensions`) and the types `PicklistReference`, `OrphanPicklistExtension`, `ResidualPicklistInput`, `ResidualPicklistWording`, `UnreferencedResidualPicklist` and `UnreferencedResidualPicklists`.
- **`@objectstack/objectql`** re-exports `unreferencedResidualPicklists` and its four types from the package root. The `manifest` service's `INVALID_METADATA` refusal of such a picklist is now that judgement's sentence, and the engine's picklist walk is the one in `@objectstack/metadata`. The residual registration of a composed stack now throws the body seam's own refusals for a permission set whose `packageId` names another package (`VALIDATION_ERROR` / 400 with `issues[]`) and for a `views:` entry that is not a view container (`INVALID_METADATA` / 422), instead of rebuilding each.
- **`@objectstack/cli`**: the `picklist-residual-unreferenced` finding of `os validate` and `os build` is read from the same judgement. Its `--json` shape (`severity`, `rule`, `where`, `path`, `message`, `hint`) and its text are unchanged.

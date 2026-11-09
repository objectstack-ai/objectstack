---
'@objectstack/cli': patch
---

Clause-②: no (narrowing)
Metadata-protocol: none

`os validate` and `os build` now resolve a field's `picklist` the way the runtime does (ADR-0150 D3): from the package that declares the field, then its declared dependency closure (plus `sys`). A field naming a list that only a sibling package of the same artifact declares, with no declared dependency on that package, is refused as `picklist-reference-unknown` in the runtime's own sentence. Before, the door accepted it, while the boot served the field no options and the install refused it.

The fix is one `dependencies` entry on the package that declares the field, for example `dependencies: { 'com.example.core': '^1.0.0' }`. The refusal's hint names the entry. When that package also depends on a package the stack does not carry, the reference is reported as `picklist-reference-unverified` and not refused, as before.

Two more references are now refused, as the boot already refuses them (`INVALID_METADATA`), whatever the outside dependencies:

- a field whose package declares dependencies on two packages of the stack that both declare the list;
- a `picklistExtensions` entry whose `extend` names a list two packages of the stack declare. An extension still needs no dependency: its target resolves against any single holder in the stack.

The fix for both is to keep the list in one package.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored shape changes. The author-time door now refuses a field reference the runtime already refuses (ADR-0150 D3), and the fix is a `dependencies` entry the author writes, so there is nothing for a migration to rewrite. -->

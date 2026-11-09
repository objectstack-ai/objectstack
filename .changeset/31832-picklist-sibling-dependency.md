---
'@objectstack/cli': patch
---

Clause-②: no (narrowing)
Metadata-protocol: none

`os validate` and `os build` now resolve a field's `picklist` the way the runtime does (ADR-0150 D3): from the package that declares the field, then its declared dependency closure (plus `sys`). A field naming a list that only a sibling package of the same artifact declares, with no declared dependency on that package, is refused as `picklist-reference-unknown` in the runtime's own sentence. Before, the door accepted it, while the boot served the field no options and the install refused it.

The fix is one `dependencies` entry on the package that declares the field, for example `dependencies: { 'com.example.core': '^1.0.0' }`. The refusal's hint names the entry. When that package also depends on a package the stack does not carry, the reference is reported as `picklist-reference-unverified` and not refused, as before. A `picklistExtensions` entry's `extend` still resolves against any package of the stack.

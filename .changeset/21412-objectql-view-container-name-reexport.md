---
'@objectstack/objectql': patch
---

`viewContainerNameRefusal` is now re-exported from `@objectstack/metadata/view-container-name`

Clause-②: no

The divergent view-container `name` judge moved to `@objectstack/metadata`, the one layer the boot loop, the artifact/HMR loader and the runtime save door all depend on, so all three call one judge. `@objectstack/objectql` keeps the `viewContainerNameRefusal` export, its signature and the `ViewContainerNameRefusal` type. The boot loop's refusal and the words it and `os validate` print are unchanged, byte for byte.

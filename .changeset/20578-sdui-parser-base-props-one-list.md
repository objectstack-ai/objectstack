---
'@objectstack/sdui-parser': patch
---

The save gate's base-prop list now matches objectui's `SDUI_BASE_PROPS` at the console pin `db11afd4967c` (objectui#11008, #11044). Five keys join the `every-node` set: `bind`, `hidden`, `visibleWhen`, `hiddenOn`, `testId`. Six `BaseSchema` keys become `where-undeclared`: `name`, `label`, `description`, `placeholder`, `data`, `ariaLabel` are accepted without `unknown-prop` on a type whose registration declares no input of that name, and a type that declares one keeps its declared type check.

Effect: `os validate` no longer warns `unknown-prop` on those keys where the protocol declares them. Only warnings disappear. No component in the served manifest declares any of the five `every-node` keys, and a declared `where-undeclared` key is still checked exactly as before, so no error-severity diagnostic is removed and no previously-rejected page is newly accepted as an error. The list is module-local here (no export); `codegen.ts` is unchanged.

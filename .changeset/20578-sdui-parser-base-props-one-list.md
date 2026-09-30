---
'@objectstack/sdui-parser': minor
---

`@objectstack/sdui-parser` now reads one base-prop list, ported from objectui's `SDUI_BASE_PROPS` at the console pin `db11afd4967c` (objectui#11008, #11044). Both `validateTree` and the generated JSX types (`generateDts`'s `SduiBaseProps`) are driven by it.

- On every node, whatever the component declares: `bind`, `hidden`, `visibleWhen`, `hiddenOn`, `testId` are newly accepted. They no longer draw `unknown-prop`, and the generated types accept them as attributes.
- Only on a type whose registration declares no input of that name: `name`, `label`, `description`, `placeholder`, `data`, `ariaLabel` are newly accepted. A type that declares one keeps its declared type check and its declared attribute type; its generated interface `Omit`s that key from `SduiBaseProps`.

Effect for consumers: `os validate` stops warning `unknown-prop` on those keys, and a `.tsx` page that authors them now type-checks against `generateDts` output where it was a TypeScript error before. Measured on the tracked `sdui.manifest.json` (107 components), no component declares any of the five every-node keys, and every declared where-undeclared key is checked as before, so no diagnostic of error severity is removed for that manifest. The wider type surface is why this is a minor, not a patch.

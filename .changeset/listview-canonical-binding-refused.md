---
'@objectstack/lint': patch
---

`os validate` now refuses a react-page `<ListView>` bound only by the metadata-tier data source instead of accepting it. The react-blocks contract deprecates `objectName` in favour of `data={{ provider: 'object', object }}`, but no renderer reads that spelling yet — so a page written to the contract's own summary validated green and then rendered an empty list with no diagnostic, and the check tightens back to what actually renders. The refusal names `objectName` as the spelling to write, and field-name props (`columns`, `searchableFields`, filter positions, …) again resolve against it, which is also the correct object when a page carries both spellings.

Scoped deliberately: pages binding with `objectName` are unaffected, and so are the `value` and `api` data providers, a plain-array `data`, and a non-static `data` prop — all of those do render. The deprecation warnings on `objectName` and `viewType` remain, with their text corrected; both are still the spellings to write until the renderer folds the canonical data source in. Pages that were green on the canonical spelling alone now fail by design.

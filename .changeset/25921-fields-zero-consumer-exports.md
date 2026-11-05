---
'@object-ui/fields': patch
---

refactor(fields)!: retire six zero-consumer exports (four file-value helpers, the filter-condition extra operators, the grid column sum)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/fields#isImageValue, @object-ui/fields#uploadResultView, @object-ui/fields#withRecentUploads, @object-ui/fields#FILE_STORAGE_BASE_PATH, @object-ui/fields#FILTER_CONDITION_EXTRA_OPERATORS, @object-ui/fields#sumColumn) the retired operands are three file-value helper functions, a storage path constant, an operator list and a column sum helper; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these six names from `@object-ui/fields`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package: `FileField`, `ImageField` and `AvatarField` keep reading the file-value helpers, `FilterConditionField` keeps offering its extra operators and `GridField` keeps summing its columns. Only the entry stops publishing them. `fileIdOf`, `fileUrlFromId`, `readFileValue`, `readFileValues`, `fileValueForSubmit`, `isFileIdToken`, `UploadIncompleteError`, the `FileValueView` and `UploadResultLike` types, `condToMongo`, `kvToCondition`, `isMatchAllCriteria`, `FilterConditionField`, `evalArith`, `lookupAutofillPatch`, `computeRow`, `GridField`, `LineItemsField` and the `GridColumn` type stay exported unchanged.

What leaves, and what to write instead:

- FROM `isImageValue` TO `readFileValue(value)` and a check on its `mimeType`.
- FROM `uploadResultView`, `withRecentUploads` TO `FileField` / `ImageField` / `AvatarField`, which show a just-uploaded file themselves.
- FROM `FILE_STORAGE_BASE_PATH` TO `fileUrlFromId`, which builds the storage URL for a file id.
- FROM `FILTER_CONDITION_EXTRA_OPERATORS` TO `FilterConditionField`, which offers those operators itself.
- FROM `sumColumn` TO `GridField` / `LineItemsField`, which draw the column totals, or a local reduce over the rows.

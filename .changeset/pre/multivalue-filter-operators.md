---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
---

fix(ui): a multi-select field's list filter offers 「包含 / 不包含」 instead of operators the server refuses

Clause-②: no
Metadata-protocol: none

Filtering a list by a multi-value field (`multiselect`, `checkboxes`, `tags`, or a `select` / `lookup` / `user` with `multiple: true`) now offers contains, does not contain, is empty and is not empty, and the query runs, where it used to offer equals and is any of, which the server answers with `400 INVALID_FILTER`. A structured-JSON field (`json`, `address`, …) offers is empty / is not empty. A saved filter that already holds a refused operator still loads and shows it, so it can be changed. `FilterBuilder` fields accept `multiple`, and `jsonColumnFilterOperators` / `operatorsForField` are exported from `@object-ui/components`.

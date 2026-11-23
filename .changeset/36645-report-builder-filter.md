---
'@object-ui/plugin-report': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(console): the report builder adds 「+ Filter」 under the data source — a report filter on the bound dataset, drawn into the preview at once and kept on Save

Clause-②: yes (widening) — a new optional `filter` slot on `ReportBuilder` (`@object-ui/plugin-report`), two exports from `@object-ui/plugin-list` (`conditionCandidatesOf`, `conditionOptionsOf`, and the `ConditionCandidateField` type), and four new `@object-ui/i18n` keys (`report.builder.source.addFilter`, `filterAdvanced`, `filterLoading`, `filterNoFields`) in all 11 locales; no spec, schema or server change
Metadata-protocol: none

- **The filter** (`@object-ui/app-shell`): under the data source, 「+ Filter」 opens the same condition editor the dataset designer uses, over the fields of the dataset's object (their translated labels, a select's options, a lookup's record picker; hidden fields are not offered). Each condition is written into the report's `runtimeFilter`, the preview redraws with it at once, and Save keeps it; removing the last condition removes the key. Switching the data source clears the filter.
- **Which reports open in the builder:** a dataset report with a saved filter now opens in the builder when its filter is one the builder can edit (field conditions joined by AND); a filter it cannot edit (an OR, a nested group, two operators on one field) keeps the report inspector panel, as before. A filter that turns out not to be editable once the fields are read is shown as kept and saved unchanged.

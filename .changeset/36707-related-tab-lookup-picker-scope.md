---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related tab's 「+ 添加」 picker keeps to the parent's own records and names them by their name field

Clause-②: no
Metadata-protocol: none

On a record page's related tab whose child is linked by a plain `lookup`, the derived 「+ 添加」 picker listed the unlinked children of every parent's scope. An opportunity's 合同 (contracts) tab listed unlinked contracts of every account, although a contract's opportunity lookup `dependsOn` the contract's account; a pick linked another customer's contract to the opportunity. The picker now applies that lookup's `dependsOn` from the parent record: each named child field must equal the parent's value (here, only contracts of the opportunity's own account). When the parent has no value for it, or the lookup's `lookupFilters` compare with `$record`, the tab offers no picker and 「+ 添加」 creates a record directly.

The picker's label column is the picked object's name field (its declared `nameField`, else the derived title field) when the add names no `labelField`, under that field's label. It was a hard-coded `name`: on contracts, whose name field is `contract_number`, the first column was an empty 「NAME」.

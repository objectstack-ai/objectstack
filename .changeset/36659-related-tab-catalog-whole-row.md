---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related tab's 「+ 添加」 no longer reads a row's own party as its source catalog

Clause-②: no
Metadata-protocol: none

On a record page's related tab, a `master_detail` child whose one other required lookup was not a catalog opened a picker of that lookup's object anyway. An account's 合同 (contracts) tab listed every account's contacts, unfiltered, because a contract requires its primary contact; a pick would have created a contract from a contact.

A required lookup now counts as the child's source catalog only when a pick makes a whole row:

- its candidates are the same for every row — no `dependsOn` and no `lookupFilters` comparand reading `$record` (a contact scoped to the contract's account is a party of that contract, not a catalog);
- every other required field of the child is filled without a person: a non-null `defaultValue`, a select option marked `default`, `readonly`, or a computed type (formula, summary, rollup, autonumber).

Otherwise 「+ 添加」 creates a new row directly, as on a master-detail tab with no catalog. A line under a header whose product is required and whose quantity defaults (quote and opportunity lines) keeps its product picker.

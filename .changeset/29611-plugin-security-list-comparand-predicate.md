---
'@objectstack/plugin-security': patch
---

refactor(plugin-security): the RLS stored-form check reads the list operators from the spec

Clause-②: no
Metadata-protocol: none

The RLS check puts a value comparand into its column's storage form, and a `$in`, `$nin` or `$between` list member by member. It now asks `isListComparandOperator` from `@objectstack/spec/data` which operators take a list, instead of keeping its own copy of `$in` / `$nin` / `$between`. The set is the same, so no policy filter is judged differently. A later change to the spec's list operators now reaches this check without a second edit.

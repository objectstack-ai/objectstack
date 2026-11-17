---
'@object-ui/fields': patch
---

fix(fields): a lookupFilters `{ $record }` path through or to a multi-valued field is left out of the candidate query, with a development warning

Clause-②: no
Metadata-protocol: none

A `{ $record }` path through or to a multi-valued field has no single value to compare: a hop through a `multiple: true` lookup (`accounts.cb_market`), a plain path to a multi-valued field (`tags`), or a hop that ends at one (`account.markets`). The spec already states that such a path is not resolved and that lint refuses it. The lookup picker now does the same in all three shapes. It leaves the entry out of the candidate query and, in a development build, warns once per path. The warning names the path and the field that holds a list, and says the path is multi-valued.

Before, a hop through a multi-valued lookup was left out with no warning. A plain path to a multi-valued field was sent with the whole list as the comparand of a scalar operator.

Single-valued paths, literal entries and `dependsOn` query exactly as before.

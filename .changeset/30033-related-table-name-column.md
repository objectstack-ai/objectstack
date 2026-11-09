---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the related table leads with the record's name when the relation declares no columns

Clause-②: no
Metadata-protocol: none

A related list with no columns declared took its columns from the child object's `highlightFields`, which by design never list the record's title, so the related tab on a record page showed amounts and dates with no deal or contact name, and the only link in a row was its first value. The record's name (`nameField`, else the field the platform derives, ADR-0079) now leads that set, listed once even when a highlight names it, and the grid links that first column to the record. The field walk used when the child declares no `highlightFields` leads with the declared name the same way. The enlarged tab and the table in the record body read the same set. Columns an author declares on the relation are drawn exactly as declared. A `titleFormat`-only object leads with the field the platform derives, not the formatted title, which has no column behind it.

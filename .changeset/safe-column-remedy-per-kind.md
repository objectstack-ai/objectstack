---
'@objectstack/driver-sql': patch
---

Clause-②: no
Metadata-protocol: none

The drift plan's `safe` column entries for a declared field (`widen_date_to_datetime`, `widen_varchar`, `drop_column_default`) now name the remedy per object kind, as the `relax_not_null` entry already does. For an object authored in this environment, publishing the object applies the entry. For an object a package provides, which is sealed and cannot be published here, the message names `os migrate apply`, which applies it for either kind. Before, the date-to-datetime entry told a package object's reader to publish the object, which cannot apply it.

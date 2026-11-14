---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console, data-objectstack): a report drill that rebuilds its filter reads the dataset as the report's reader (ADR-0150 D3)

Clause-②: yes (widening) — `MetadataGetOptions` (`@object-ui/data-objectstack`) gains an optional `callerPackage`, which `MetadataClient.get` sends as `?callerPackage=`; omitted, every read is sent exactly as before.
Metadata-protocol: none

**The drill.** A report row drills straight to its records when the dataset answer carries the drill metadata. When it does not, the Console reads the dataset definition to rebuild the filter from the clicked group. That is not only an older server's answer: the server names the dataset's object on every answer but sends no drill metadata for a `type: 'date'` dimension with no `dateGranularity`, so a click on a report grouped by one takes this read. The read named no package, so for a report shipped in a package it read the bare name: another package's dataset of that name, or a `409` when two packages hold the name, where the report's own queries read the dataset its package resolves. The read now names the report's package as the reader (`?callerPackage=`), the dataset the report's queries resolve. A report authored in the environment reads the name bare, as before. A refusal opens no drill and is not retried with the bare name.

**The client.** `MetadataClient.get(type, name, { callerPackage })` reads an item as the package that reads it: that package's own item, else the one holder among its declared dependencies plus `sys`, else `409 RESOURCE_CONFLICT` naming the candidates. It is distinct from `packageId` (`?package=`), which names the holder exactly. The server serves the caller arm on the `dataset` read only, and refuses it beside `packageId`.

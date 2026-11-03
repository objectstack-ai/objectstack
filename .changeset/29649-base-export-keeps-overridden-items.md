---
'@objectstack/runtime': patch
---

Clause-②: no
Metadata-protocol: none

`GET /packages/<base>/export` carries the base's own document again while its `.custom` pair's override of an item is live (measured for dashboard, report, page, app, dataset, doc and book) (ADR-0146 D8 item 3). On a boot that also holds the base's code documents in the metadata service, as every `defineStack` host does, the per-package layer listed only the override copy under the base's name, and the export's override filter (#29563) left the item out of the base's export. The export now serves the base's code artifact in that item's place, so the base's export is byte-identical with or without a published override, and still carries no `overrides` block.

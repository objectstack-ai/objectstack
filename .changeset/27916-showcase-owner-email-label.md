---
'@objectstack/example-showcase': patch
---

Clause-②: no
Metadata-protocol: none

The showcase's project and invoice objects no longer show two fields called "Owner". Their own `owner`
text field, which holds the owner's email address, is now labelled "Owner Email" (负责人邮箱 in zh-CN),
so the platform's `owner_id` user lookup is the one field labelled "Owner" in the field grid, pickers and
filters. The API name stays `owner`, so seeded rows, flows, permission rules and anything else that
reads `record.owner` are unchanged.

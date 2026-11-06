---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
---

fix(app-shell,data-objectstack): Studio's and Setup's object editors edit the object as its author wrote it, not as the console is served it

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`:** the object editor in Studio's Data pillar and the one in Setup's metadata editor (`MetadataResourceEditPage` for `object`) now take their editable copy from the layered read's author-owned layers: the pending draft as stored (`draft`) when one is pending, otherwise `overlay ?? code`. Before, the copy was the `?state=draft` read (or `effective`), which arrives translated into the console's language and governed with the platform's injected columns (`owner_id`, `queue`, the audit and scope columns), so in a Chinese console one field edit saved the Chinese labels as the author's labels and sent the platform's columns back as the author's fields. What the editor shows of the served object stays as it was: the header's system-field count still counts the platform's columns, and the records grid still shows the served `owner_id` column. When a draft is pending but the layered read does not carry it, the editor installs nothing, shows the existing "draft unreadable" refusal, and sends nothing.
- **`@object-ui/data-objectstack`:** `MetadataClient.layered()` passes through the `draft` layer the server serves (`MetadataLayered.draft`, optional). It used to drop it.

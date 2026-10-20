---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an approval request is titled by its flow's label, and its title no longer shows the raw record id or the flow's machine name

Clause-②: no

- **The request page's heading is the flow's label.** Opening an approval request (Setup → Approvals → Requests, or from the approvals inbox) showed `flow:invoice_approval · Rd4bl3Rec12489QQ` as the page heading: the flow's machine name and the raw id of the record the request is about. It now shows the flow's label, such as `Invoice Sign-off`, whether the record is readable, was deleted, or cannot be resolved.
- **The title pointer is a column the approvals API serves.** `sys_approval_request` now declares `nameField` (and the deprecated `displayNameField`) as `process_label`, the stored flow-label column the request lists already show. The approvals API (`GET /api/v1/approvals/requests/:id` and its list) serves that column, so a console titles the page from it. The pointer was `display_title`, a computed field the approvals API does not serve, so the console drew the `titleFormat` template instead.
- **The record is named on the Details tab, not in the title.** The Details tab's record card, drawn from the `record_id` / `object_name` pair, names the record and says when the reader may not read it or the platform deleted it. A title cannot say either, so it shows no record id.
- **The fallback is the flow's source.** `titleFormat` is now `{process_name}` (was `{process_name} · {record_id}`). A renderer draws it only where `process_label` is empty: a request written before that column, until the startup backfill labels it. The approvals API never reaches it, because it serves a label for every request (the stored one, else the label recorded when the request was opened, else the flow's name humanized).
- **`display_title` computes the same text.** The formula is now `process_label`, else `process_name`, with no ` · record_id` half, so the data API's `display_title` equals the title every door draws. It stays declared because existing activity entries name it as the source of their text.
- **Search results follow.** The global search palette titles a request by `nameField` first, so a request now appears there under its flow's label.

A patch: one platform object's title pointer, its title template and its title formula's expression change. No field, export, type, accepted value or stored column is added or removed.

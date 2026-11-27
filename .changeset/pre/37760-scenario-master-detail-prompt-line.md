---
'@objectstack/scenarios': patch
---

fix(scenarios): the build prompt names a card's master-detail as a master-detail, not as a lookup

Clause-②: no
Metadata-protocol: none

A card carrying `records-forms.master-detail-inline-edit` is credited only for a `master_detail` field edited inline on its master, but the build prompt listed that relationship under "Lookups", so a faithful build declared a `lookup` and lost both of the tag's checks (the `project_with_tasks` card lost them on every run).

- A card's `expect.lookups` row takes an optional `masterDetail: true`. The build prompt states such a row on its own line: "Master-detail relationships, each a `master_detail` field (not a `lookup`) on the detail object referencing its master, the detail's rows entered inline on the master's form: …", and the "Lookups" line keeps the rest.
- The loader refuses a card that carries the inline-edit tag and marks no row, at `expect.lookups`.
- The six library cards that carry the tag mark their detail relationship: `invoice_line.invoice`, `task.project`, `order_line.order`, `claim_line.claim`, `leave_day.request`, `po_line.purchase_order`. Every other card's prompt is unchanged byte for byte.

Scoring is unchanged: the exact-name `lookup:` check reads the target only, so a `lookup` and a `master_detail` both pass it, and the tag's own rows still judge the type.

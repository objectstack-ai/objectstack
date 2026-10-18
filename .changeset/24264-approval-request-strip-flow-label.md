---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approval request page's highlights strip names the flow by its label, not `flow:NAME`

Clause-②: no

- **The strip's first chip is the flow's label.** `sys_approval_request_detail` lists `process_label` (the "Flow" field) where it listed `process_name`, so a request opened by the Deal Desk flow reads `Deal Desk` there instead of `flow:deal_desk`. The request lists already showed this label.
- **The object's `highlightFields` makes the same swap** (`process_label` in place of `process_name`, `record_id` kept). The page's Details tab is a bare `record:details` node, which draws the object's `highlightFields` minus the strip. A change to the strip alone would have moved `process_name` into that tab. Changed together, the tab still shows only the target record card. Other surfaces that read the object's list show the flow's label too: a request's record preview card, Studio's object settings, and the default columns of a list, kanban, related list or lookup picker that declares none. No first-party request list uses the default columns: each request list view declares its own.
- **When no label is available.** The console reads a request through the approvals get, which serves `process_label` as the stored label, else the flow label in the request's node-config snapshot, else the humanized machine name (`flow:deal_desk` → `Deal Desk`). A request the boot backfill has not labelled still shows a Flow chip. Only when all three are empty does the field have no value: the strip then draws no Flow chip, and the record title still names `process_name`.

A patch: one entry in one platform object's field list and the same entry in its page. No export, type, accepted value or stored column changes.

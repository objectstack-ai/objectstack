---
"@objectstack/plugin-approvals": minor
---

Approver join table — the #1745 follow-up that makes approver-filtered pagination exact. New `sys_approval_approver` object holds one row per (pending request, approver identity); the service mirrors every `pending_approvers` change into it (open / decide / recall / send-back / reassign / SLA-escalate) and clears the rows when a request leaves `pending`, so the table tracks the live work queue, not the append-only history. `listRequests` / `countRequests` now resolve approver filters through this index (`$in` on indexed equality instead of a per-row CSV scan) and push status arrays down as `$in` — every filter is engine-side, so the page window and totals are correct at any table size; the old 500-row bounded-scan residual is gone. `rebuildApproverIndex()` rebuilds the index from the CSV source of truth, and runs idempotently at plugin start to backfill rows written before the index existed.

---
"@objectstack/plugin-approvals": minor
---

Approval nodes now resolve `field` / `manager` approvers against the record's **live** state at node entry, not the trigger snapshot the flow froze at submit time (#3447). An earlier step — or the approver of an earlier step — can now write the field that routes a later step's approvers, enabling dynamic routing / dynamic co-sign (e.g. a lead reviewer picking which departments co-review, then those departments resolving as parallel approvers). Graph approvers (team / position / department / tier) already resolved live; this brings the in-record types into line.

Also fixes two latent defects on the same path: a multi-select user field now fans out into one approver slot per user (previously the array was stringified to a single bogus id), and out-of-office delegation is applied per fanned-out user (previously silently skipped for multi-value fields). When the record can't be re-read (hard-deleted mid-flow, or a backend that can't serve a point read), resolution falls back to the trigger snapshot and warns rather than wedging the flow.

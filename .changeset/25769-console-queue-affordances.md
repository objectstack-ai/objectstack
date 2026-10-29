---
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(console): ownership queues in the Console — a queue picker reading both sources, a Claim button the server decides, and an "In a queue" list filter

Clause-②: no
Metadata-protocol: none

The server half of ownership queues shipped without a Console face. Now:

- **Queue pickers list both sources.** The flow designer's approver Value for a `queue` approver, and a sharing rule's `queue` recipient, list the queues an installed app declares (`GET /api/v1/meta/queue`) together with the organization's own `sys_queue` records, one list by machine name, and store the name. The approver picker follows the binding the server publishes (`registry-and-data`); with no data adapter, or a server that publishes another binding, it keeps the text box.
- **Claim.** A record sitting in a queue (no owner, a `queue` named) shows **Claim** in its header only when the explain engine's answer for a transfer of that record carries an admitting `queue_claim` rule; no answer means no button. Claim sends `{ owner_id: <self> }` through the normal update, and a lost race (`409 CONCURRENT_UPDATE`) is reported as "Someone else claimed this record first."
- **In a queue.** A list of an object served with the injected `queue` column gains an **In a queue** toggle that narrows the fetch (and an export) to `owner_id` empty and `queue` set. Which of those rows come back is still the server's read filter.
- **Docs.** A new authoring guide, *Queues and assignment rules*, covers declaring a queue and an assignment rule, the `load` requirement, what a parked record is and who sees it, how a claim is spelled, and that a queue is not a messaging audience; the approvals, sharing-rule and RLS pages link to it.

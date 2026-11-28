---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): a chat approval card restored after its pending action lapsed reads "Expired" at once, not after a press

Clause-②: no
Metadata-protocol: none

A card restored from a saved conversation says `approval-requested` whatever became of its pending action since. `useHitlInChat` now reads each awaiting card's row once, through `GET /api/v1/ai/pending-actions/:id` (the endpoint the AI Approvals inbox reads): a lapsed row (`status: 'rejected'`, `rejection_reason: 'lapsed'`, no `decided_by`) settles the card on "Expired" with no buttons, and a row a person rejected settles it on that rejection. A row still pending or settled any other way, or a read that gets no answer, leaves the buttons as before; a decision made on the card meanwhile is never overwritten. A host whose tests script `fetch` in call order sees one extra `GET` per awaiting card.

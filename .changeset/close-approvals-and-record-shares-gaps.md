---
"@objectstack/client": minor
"@objectstack/rest": patch
---

feat(client): close the approvals (6) + record-shares (3) REST gaps (#3587 batch 3/5)

`client.approvals` gains the full request lifecycle beyond approve/reject:
`recall` (submitter withdraw), `revise` / `resubmit` (ADR-0044 send-back
round-trip), and the thread interactions `remind` / `requestInfo` / `comment`.
New `client.shares` namespace for per-record sharing grants: `list` / `grant` /
`revoke` (204-safe) under `/data/:object/:id/shares`. REST route-ledger
ratchet: 26 → 17.

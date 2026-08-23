---
'@objectstack/rest': patch
---

`GET /meta/_drafts` threads the caller's org into `listDrafts` (#11087) — read scope symmetric with the save route, so org-scoped drafts (saved by sessions carrying an active organization) appear in the pending-changes list alongside env-wide ones instead of being invisible to every package/pending surface.

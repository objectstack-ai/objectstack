---
'@objectstack/lint': patch
---

fix(lint): a liveness finding's fix text is the row's `authorHint`, else the verdict's default hint, and never the row's internal ledger `note`, for every row class. Before this, a row that opted in with `authorWarn`, and an `experimental` row, with no `authorHint` printed its `note` as the fix text: on `app-showcase`, the two `liveness-planned-property` findings for `externalSharingModel` printed a 728-character maintainer note that cites a tracker id. They now print "Keep it — a consumer is being built against this property; it has no runtime effect yet." No rule id, message, severity or exit code changes, and a row that has an `authorHint` prints it exactly as before (#21096)

Clause-②: no

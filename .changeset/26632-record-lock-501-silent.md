---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): a record page on a deployment without the approvals service no longer logs the record-lock read's 501

Clause-②: no
Metadata-protocol: none

On a deployment that composes no approvals service, such as a fresh `npm create objectstack` scaffold, every record page asks the server whether an approval locks the record, and the server answers `501 NOT_IMPLEMENTED`. That answer is designed: it means there is no lock service, so no approval can lock the record, and the page already treated it that way. But the read went through the SDK client, which logs every non-2xx response as an error before its caller sees it. So each record open printed `HTTP request failed: GET /api/v1/approvals/records/OBJECT/ID/lock -> 501 [NOT_IMPLEMENTED]` in red, which reads like a broken server.

What changes:

- The record page reads the lock directly, the same way it already reads the approval requests, so no client logger runs first. A 501 is read silently.
- After a 501, the page does not ask again for any record until the page is reloaded. The browser's own network line for that first request still appears once, because the server answers the approval-requests read `200` with an empty list and the page cannot tell the service is missing until it asks.
- Any other failure of the lock read still logs, through the same logger the SDK client used: `HTTP request failed: GET URL -> STATUS [CODE]`, with a 404 still demoted to a debug line. The next record open asks again.

What to do: nothing. Nothing a flow, page or object declares changes.

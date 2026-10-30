---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: no
Metadata-protocol: none

Studio's record-sharing (OWD) overview no longer dead-ends when "Controlled by parent" is saved on a detail object whose master-detail field is not yet required. The save makes that relationship required, which the server's destructive-change guard answers with a 409; the panel now opens a confirm naming the relationship (`field → master`) and what the server said would change. Confirming retries the same save with `force`; cancelling saves nothing. The server guard is unchanged.

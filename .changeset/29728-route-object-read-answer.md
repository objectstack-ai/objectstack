---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
---

Clause-②: no
Metadata-protocol: none

An app route whose object definition the server failed to serve now shows the server's own reason, instead of asking the person to check their connection (#29728).

- When the by-name object read is answered with a 5xx, or with a 404 whose code this build does not know, the route's failed-read state draws the server's sentence and its code, the same way the list, record and app-page states already do (`answeredLoadFailure`). "Check your connection and try again" now appears only when no server answered. A refused read (403) keeps the state it drew before. Retry is unchanged.
- `@object-ui/data-objectstack`: `ObjectStackAdapter.getObjectSchema` keeps the transport's own error as `details.originalError` when it rewraps a non-404 failure, as its 404 arm already did. The thrown error's class, `code`, `statusCode` and `message` are unchanged. Read the cause, not the wrapper, to learn whether and what the server answered: the wrapper replaces the server's code with its own (`CONNECTION_ERROR`, `UNKNOWN_ERROR`) and reports status 500 for a request that got no answer.

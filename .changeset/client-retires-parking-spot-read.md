---
'@objectstack/client': minor
---

`err.code` no longer falls back to the pre-#3842 parking spot (`error.details.code`). The "newer SDK, older server" pairing that read served is not a supported deployment (SDK and server ship as one fixed release group), and the ADR-0112 batch-1 rename changed the code values anyway — a code dug out of an old server's parking spot would match no branch written against the current catalog (#4007). `err.category` / `err.retryable` are now read from inside `error`, where `ApiErrorSchema` declares them; the old top-level read yielded `undefined` against every conformant server (#4006).

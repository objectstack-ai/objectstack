---
'@object-ui/data-objectstack': patch
---

Clause-②: no
Metadata-protocol: none

A `ConnectionError` for a request nothing answered (an unreachable host, a rejected `fetch`) no longer reads as a server that answered with a 503 (#29916).

- The `ConnectionError` constructor leaves `statusCode` undefined when the caller passes none. Before, it stamped `503`. `connect()` builds it that way when discovery's `fetch` rejects, every data method opens with `await this.connect()`, and the post-connect `error` connection state builds it the same way, so a read against a down backend was taken for the server's own answer. `answeredLoadFailure` now returns `null` for it and `classifyLoadError` reads `network`, so a failed-read state keeps its "check your connection" sentence.
- A discovery read the server answered with an error status (`!res.ok`) now carries that status (a 401 reads as `unauthorized`), instead of the invented 503.
- An answered 503 or 504 through `createErrorFromResponse` keeps its status, as before.

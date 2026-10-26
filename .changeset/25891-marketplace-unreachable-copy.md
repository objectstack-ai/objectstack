---
'@object-ui/app-shell': patch
---

fix(app-shell): Browse Marketplace says the catalog could not be reached when the runtime cannot reach it, instead of "the catalog answered with an error (HTTP 502)"

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`**: the runtime's marketplace proxy answers `502 MARKETPLACE_PROXY_FAILED` only when its own fetch to the catalog throws. The load-error panel picked its class line by status alone, so that answer read "The marketplace catalog answered with an error (HTTP 502)", with the raw transport text `fetch failed` in full view below it. The panel now reads the error code as well: that code, or no answer at all, reads "The marketplace catalog could not be reached.", and the raw text sits behind a **More** / **Less** disclosure with a copy button. A failure the catalog did answer, including a 502, 503 or 504 relayed from upstream, still names its HTTP status and shows the server's own text. The online hint is unchanged.

What to do: nothing.

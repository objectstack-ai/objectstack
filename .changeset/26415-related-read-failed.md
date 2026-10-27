---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list whose read fails says so instead of showing "No related records found"

Clause-②: no
Metadata-protocol: none

When a record page's related list could not read its rows (a refused read, a server error, a network failure), it drew its ordinary empty state, "No related records found", and only logged the failure. A reader was told a record had no related rows when the console simply could not read them, and on a Related tab the list was also folded into the stack's line of empty lists.

- **A failed read draws one load-failed line on the list's card**, with a Retry button. It reads "Couldn't load records" with the server's own sentence when the server answered with one, or the generic "Something went wrong while loading this data" when it did not.
- **A refused read uses the console's shared no-access wording**, the same as a list view: "You don't have access. You don't have permission to view these records." The server's text is not shown for a refused read. A signed-out session and an object whose API is disabled get the list view's sentences for those cases too; the API-disabled case offers no Retry, because retrying cannot change it.
- **Both fetch paths.** The adapter path and the legacy raw-URL path both draw the line. On the raw-URL path a non-2xx answer is now a failed read; it used to be parsed as a result with no rows.
- **The stack fold leaves a failed list in its own row.** A failed list never reports itself as empty, so it is not folded into the empty-lists line, and its header shows no record count.
- **Retry clears the failure and reads the list again.**

What to do: nothing.

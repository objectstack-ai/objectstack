---
"@objectstack/rest": patch
---

fix(rest): the `UNIQUE_VIOLATION` 409 now names the conflicting field, matching the bulk path (#7821)

A single-record write that violated a `unique` field came back as

```json
{"error":"A record with this value already exists","code":"UNIQUE_VIOLATION","object":"invoice"}
```

— no `field`. On an object with several unique fields the caller was told only
that *a* value was taken and had to guess which one, and a client that wanted to
render its own localized message could not name the field either, because the
body carried nothing to name it with.

The platform already knew the answer. Since #6544 the **bulk / import** path
resolves the colliding column through `uniqueViolationColumn` and says *"A record
with this `email` already exists."* The **single-record** path held the same
error object, sat one import from the same helper, and withheld it. One rule, two
implementations, one strictly worse.

The 409 body now carries the field, and its default message reaches parity:

```json
{"error":"A record with this email already exists","code":"UNIQUE_VIOLATION","field":"email","object":"invoice"}
```

**Reading the error object, not its message, resolves more than the bulk path
can.** `sanitizeRowError` only ever holds a string, so it reads the message
channel alone; this site has the whole error, and `uniqueViolationColumn`
additionally reads `detail` and one step of `cause`. That is where the column
actually is for the Postgres driver we ship — node-postgres keeps its
`DETAIL: Key (email)=(…)` line on `error.detail` and off the message — so that
shape now names `email` where a string-only read answers nothing.

**When the driver does not determinably name a column, nothing is guessed.** An
index name (MySQL's `for key 'idx_email_unique'`, SQLite's `index 'x'`), a
composite key, or prose the helper does not parse all produce the unnamed
sentence and **no `field` key at all**. A wrong field name is worse than none: it
sends the user to correct an input that was never the problem. MySQL deployments
therefore keep the unnamed message — that is `uniqueViolationColumn`'s documented
and deliberate cost, not a gap here.

Unaffected: the status is still `409`, the code is still the registered
`UNIQUE_VIOLATION`, `object` is unchanged, and adding `field` is additive. The
bulk path is untouched and still names the field exactly as it did. The
withholding this branch enforces is intact — the offending user data
(`Duplicate entry 'acme@example.com' …`), the index name, and the `table.`
qualifier still never reach the wire; `sys_user.email` is reported as `email`.

Not addressed here: the message is still built-in English. Localizing
platform-built-in error copy is one architectural answer owed to this string,
`DELETE_RESTRICTED` (#7307) and `sanitizeRowError`'s siblings together, and is
deliberately left to that decision. The `field` on the wire is what lets a client
build its own localized message today.

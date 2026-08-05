---
"@objectstack/rest": patch
---

fix(rest): a declared 5xx no longer ships its own message to the client (#5437)

**Behaviour change — read this if you operate a deployment or parse REST error
bodies.** An error that carries an explicit `status` of 500 or above now reaches
the client as `{ "error": "Internal server error", "code": "<the producer's
code>" }`. The status and the code are unchanged; only the free-text message is
withheld, and the full original text is written to the server log.

**What was wrong.** `sendError` — the error path of the metadata, UI, discovery
and batch routes — passed an explicit status straight through for the whole
400-599 band, so a declared 5xx returned `error.message` verbatim without
passing through any of the sanitizing heuristics (`isSqlLeak`,
`looksLikeInternalErrorLeak`, the `Internal data error` envelope). The sibling
branch in `mapDataError` stops at 4xx on purpose, with the reason written down:
"5xx messages keep going through the sanitizing heuristics below so
internal/SQL details never reach the client verbatim". Two opposite verdicts on
one question, and the routes that report through `sendError` got the permissive
one.

That was reachable, not theoretical. `metadata-protocol` interpolates the raw
driver error into two client-facing 500s — the customization-overlay persist and
delete failures — so a real driver line such as `SQLITE_ERROR: no such table:
sys_metadata`, `relation "sys_metadata" does not exist`, or a unique-constraint
payload naming physical columns was returned to whoever made the request. The
only thing standing in the way was a 500-character bound, and driver errors are
far shorter than that. Length was never a proxy for leakage; on this side of the
bound it failed open.

**Accepted cost.** A 5xx message written *for* the caller now reaches them as
the generic sentence plus its code. Two concrete examples: the overlay-persist
failure's "In-memory registry was updated but will be lost on restart", and the
atomic-batch refusal's "retry without options.atomic, or probe
capabilities.transactionalBatch on /discovery first". Both remain fully readable
in the server log, and the machine-readable `code` (`OVERLAY_PERSISTENCE_FAILED`,
`NOT_IMPLEMENTED`) still rides on the response, so a client keying on codes is
unaffected. If you were surfacing 5xx `error` text in an operator console, read
it from the log instead — `[REST] Unhandled error` for a genuine fault, and a
new `[REST] 5xx message withheld from client` line for the 502/503 lifecycle
statuses that the unhandled-error predicate deliberately keeps quiet.

The message is dropped unconditionally rather than filtered by keyword: a
predicate would only move the question to "does the heuristic know this
dialect", which is the failure mode that produced the bug. 4xx behaviour is
untouched — an over-long client message is still truncated rather than erased
(#5423 / #5436).

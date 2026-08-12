---
"@objectstack/rest": patch
---

fix(rest): the direct-mount package door withholds a leaky 5xx message, like its two siblings already do (#8086)

A driver failure under `/api/v1/packages` returned the driver's own line to the
API client. Reproduced end to end through a real `ObjectQL` engine and a real
`ObjectStackProtocolImplementation`, with the driver failing the `sys_metadata`
read the way a missing table does — `DELETE /api/v1/packages/:id` answered:

```
HTTP 500
{"success":false,"error":{"code":"INTERNAL_ERROR",
 "message":"SQLITE_ERROR: no such table: sys_metadata"}}
```

That path is not exotic: a full uninstall (no `?version=`) routes to
`protocol.deletePackage`, whose first database touch sits outside its own
per-item `try`, so the driver line propagates whole into this registrar's
catch-all and onto the wire.

**Not a new rule — the rule this surface already followed, at the door that was
missed.** Both siblings sanitize: the dispatcher twin (`HttpDispatcher.error`)
has replaced a leaky 5xx message with the generic text since #3867, and
`rest-server.ts` runs the same predicate at three call sites. The earlier fix
for this class (#5437) reached neither this registrar nor could it, because
this door does not go through `resolveErrorResponse` at all. `/api/v1/packages`
has **two** HTTP doors and this one mounts first in the production stack, so
the unfiltered answer was the live one — one deployment, two different answers
to the same failure.

**Only the prose is withheld.** `status`, `code` and `details` are untouched,
so a client can still branch on the code and the coded-refusal mapping added in
#8016 still answers. The full text still reaches the server log and the error
reporter.

**4xx is deliberately untouched.** A refusal's message is caller-facing by
design — `[tenant_scope_required]` names the exact parameter to pass, a `409
DESTRUCTIVE_CHANGE` names the remedy — and it is disclosed where disclosure
costs nothing, because the caller supplied the input. Withholding those would
delete the self-correcting sentence that makes the refusal actionable.

**Known ceiling, stated so a green suite is not mistaken for full coverage.**
The shared predicate is a heuristic over the message and does not recognise
Postgres's `relation "…" does not exist` phrasing, so that dialect's line still
travels — here and through the dispatcher twin alike, since both run the same
predicate. Widening it at one door would re-create the divergence this closes.
The cure is to stop interpolating driver text into client-facing messages at
the producer, which is tracked separately.

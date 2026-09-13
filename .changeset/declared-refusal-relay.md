---
'@objectstack/types': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

A producer-declared 5xx **refusal** now keeps its message on the wire, at every door that reads the declaration.

`ApiErrorSchema.refusal` (`@objectstack/spec`) is the producer-side declaration that a 5xx is a deliberate refusal whose `message` is authored for the caller. Until now nothing read it: all three arms that withhold a declared 5xx's prose could tell only that the producer had declared a *status*, so a refusal and a driver fault were sanitised alike and every producer-declared 5xx refusal reached the caller as `"Internal server error"`.

The read is one new function, `declaredRefusalMessage` (`@objectstack/types`), called by all three arms — `declaredServerFaultAnswer` and `resolveErrorResponse`'s 5xx passthrough in `@objectstack/rest`, and `errorResponseBase` in `@objectstack/runtime`. REST's logging follows the same field: a declared refusal is no longer logged as `[REST] Unhandled error`.

**What changes for a caller.** A 5xx whose producer sets `refusal: true` beside a `status` (or `statusCode`) in the 500-599 band and a non-empty `code` now carries that producer's message, bounded exactly as a 4xx message is. The first live case is `GET /api/v1/meta/:type/:name/references` for an unanswerable target, whose ADR-0110 D3 sentence ("Ask the owning object instead: …") reaches an operator again.

**What does not change.** Everything else, and the default is fail-closed: a declared 5xx that carries no `refusal` is withheld exactly as before, an undeclared 5xx still goes through the leak heuristic, and a rewrap that drops the flag is withheld as a fault. A refusal cannot buy leaky prose past `looksLikeInternalErrorLeak` either — the declaration says the prose is *addressed* to the caller, not that it is *safe*.

**For producers.** Setting `refusal: true` on a thrown 5xx is opt-in and additive; a producer that does not set it is unaffected. Platform and driver code must never set it on a fault.

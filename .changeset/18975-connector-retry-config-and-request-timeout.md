---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/connector-rest': minor
'@objectstack/connector-openapi': minor
---

feat(connectors): a connector's declared `retryConfig` and `requestTimeoutMs` are executed, not just parsed (#18975)

Clause-②: yes (widening)

`ConnectorSchema.retryConfig` (eight sub-keys) and the two timeouts beside it
parsed, stored, and reached nothing. An author who wrote a retry policy — the
one `packages/spec/docs/SYNC_ARCHITECTURE.md` points at for a rate-limited
upstream, whose `retryableStatusCodes` default includes `429` — got
configuration that looked applied and did nothing, with no error and no
warning. ADR-0049 owed these keys a decision and ruled **implement**.

**Where it landed: one wrapper, not a gateway.** `resilientFetch`
(`@objectstack/spec/shared`) already was the platform's outbound-HTTP call for
connectors — it gave every attempt a 30s timeout and a fixed exponential
backoff. What it could not express was the declared policy, so it gains exactly
the knobs that were missing (`strategy`, `backoffMultiplier`, `maxDelayMs`,
`jitter`, `retryOnNetworkError`), each defaulting to the behaviour it already
had. One new function, `connectorFetchOptions()`
(`@objectstack/spec/integration`), is the single mapping from a connector's
declared policy onto those options — one execution site, not one per connector
package.

**How the authored value gets there.** `ConnectorProviderContext` gains
`retryConfig`, `connectionTimeoutMs` and `requestTimeoutMs`, read-only and
resolved from the entry (the automation service parses `retryConfig` so a
factory reads real values instead of re-deriving the schema's defaults), so a
custom provider that does its own I/O can honour them. The built-in HTTP
providers — `rest` and `openapi` — honour them by construction.

What an author now gets from each key: `strategy` picks the growth shape
(`exponential_backoff` / `linear_backoff` / `fixed_delay` / `no_retry`);
`maxAttempts` bounds the calls (it counts TOTAL attempts with the first
included, the contrast `content/docs/automation/flows.mdx` already draws against
`maxRetries`, and `maxAttempts: 0` still makes the one call and never retries);
`initialDelayMs` and `backoffMultiplier` shape the delay; `maxDelayMs` caps it,
applied after jitter so the declared ceiling is a real one — and an upstream
`Retry-After` longer than that ceiling ends the retry loop and returns the
response, rather than sleeping past a maximum the author declared;
`retryableStatusCodes` both widens and narrows what is retried;
`retryOnNetworkError` governs a thrown attempt; `jitter` can now be turned off;
`requestTimeoutMs` becomes the per-attempt deadline.

**Two behaviour changes to know about.** A connector that declares a policy now
retries per that policy where it previously did not retry at all — that is the
fix, and a connector that declares none is on exactly its prior behaviour.
Separately, `connector-openapi`'s generated actions went through a naked
`fetch`: unbounded, never retried, and the one built-in HTTP path an authored
policy could never reach. They now go through the same wrapper as
`connector-rest` and `connector-slack`, which gives them the 30s per-attempt
timeout and bounded retry those two already had.

**⚠️ `connectionTimeoutMs` is NOT enforced, deliberately, and is the one thing
the ruling assumed that measurement refused.** A connector's call is a WHATWG
`fetch`, whose only cancellation surface is one `AbortSignal` over the whole
operation; nothing in that interface observes the connection phase separately.
Bounding time-to-response with it would kill a slow-but-connected upstream the
author meant to allow with a large `requestTimeoutMs` — breaking the very
promise the key makes. So it is carried onto `ConnectorProviderContext` (a
custom provider on a transport that *can* separate the phases may honour it)
and left unenforced by the platform, with the reason recorded at the mapping and
in `packages/spec/liveness/connector.json`, which keeps that one row `dead`. It
is owed a second, narrower ADR-0049 decision: retire it, or re-describe it as
something the platform can enforce.

Nine of the ten ledger rows flip `dead` → `live` with the consumer site named.
No declaration moves: the connector schema keeps every key, every bound and
every default it had.

---
"@objectstack/service-automation": patch
---

fix(service-automation): node input-schema validation now guards EVERY attempt of a retried flow, not only the first (#9889)

Before this fix, `validateNodeInputSchemas` — the guard that refuses to run a
flow whose node `config` violates its own declared `inputSchema` — was called
only by `execute()` (attempt 1). Under `errorHandling.strategy: 'retry'`, the
guard's throw routed into `retryExecution`, and every retry attempt ran
through `executeWithoutRetry` with no guard at all: the nodes attempt 1
refused to run were executed for real, with the config the guard rejected. A
side-effecting node (a data write, an HTTP call, an email) behind a
mis-declared `inputSchema` was reachable simply by declaring `retry`.

Now both attempt paths call the same guard, so flows that were previously
running on retry with a mis-declared `inputSchema` will be refused on every
attempt (`success: false`, `status: 'failed'`, with the guard's message).
Retry accounting is unchanged: each refused attempt still consumes retry
budget, and valid flows retry exactly as before. If a flow of yours starts
failing with `missing required input parameter` or `expected type ... but
got ...` after this release, it was already being refused on its first
attempt — fix the node's `config` to match its declared `inputSchema`.

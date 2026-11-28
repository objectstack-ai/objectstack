---
'@objectstack/runtime': patch
'@objectstack/hono': patch
'@objectstack/types': patch
---

fix(runtime,hono): an error answer a dispatcher domain returns with a `userMessage` says it varies by `Accept-Language`

Clause-②: no
Metadata-protocol: none

An error answer whose body carries a `userMessage` is in the caller's language, so it now carries `Vary: Accept-Language`, as the thrown refusals already do. This covers the answers a dispatcher domain catches and composes itself: `HttpDispatcher.errorFromThrown`, a `deps.error` call carrying a `userMessage` (the automation resume and trigger doors' `FLOW_FAILED`), the `/actions` door, and the dispatch foot's marked `PERMISSION_DENIED`. Both exits that send such an answer ask the body: `@objectstack/runtime`'s dispatcher plugin and `@objectstack/hono`'s `createHonoApp`. The token is appended, so a `Vary` that CORS, compression or the route writes keeps its own tokens. Status codes, error codes and bodies are unchanged, and an answer with no `userMessage` gets no new header.

---
"@objectstack/spec": minor
---

feat(spec): codify the IHttpServer soft extensions and unmatched-request semantics (#3607, ADR-0076 OQ#10 follow-up)

Three behaviors every adapter already implements — locked until now only by
the `@objectstack/http-conformance` cross-adapter suite — become formal
contract on the interface: `IHttpResponse.write`/`end` (SSE/chunked
streaming: headers flush on first write, no buffering until end, `end`
required wherever `write` exists), `IHttpServer.getPort()` (real bound port
after `listen()`, incl. ephemeral `listen(0)`), and the unmatched-request
semantics (path-miss → 404 with the shared not-found body; method-miss →
405 with an `Allow` header). All members optional with feature-detect
guidance — zero behavior change, both adapters already conform; the
conformance assertions now cite the contract instead of merely observing
parity.

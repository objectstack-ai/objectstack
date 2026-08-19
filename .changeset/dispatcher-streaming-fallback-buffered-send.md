---
"@objectstack/runtime": patch
---

The dispatcher's two write-less-transport fallbacks for streamed results now implement the IHttpResponse streaming contract's own prescription (#3607, ADR-0076 OQ#10): when a transport's response object lacks the optional `write`/`end` streaming surface, the SSE frames are buffered and delivered through `send()` under the streaming headers, byte-identical to what a streaming transport would have written. Previously the route-wrapper fallback answered a bare JSON `{ events }` body no SSE reader could decode, and the dispatch-result writer fell through to serializing the stream descriptor itself — collapsing its `events` AsyncIterable to `{}` and losing every event silently under HTTP 200. Both branches are reachable only through an externally supplied `Runtime({ server })` transport without streaming support; callers of such compositions that parse the streamed and buffered bodies with the same SSE reader now decode identical frames from either.

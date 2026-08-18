---
"@objectstack/dogfood": patch
---

docs(qa): record `dispatcher-plugin.ts` as deliberately outside the #2992 transport tripwire set, with the reason (#9410)

`packages/runtime/src/dispatcher-plugin.ts` has both properties that make a file
a plausible landing site for a realtime transport, and neither the conformance
test nor the protocol page said anything about it. It **mounts routes** —
`/actions`, `/automation` and `/packages`, the registration path separate from
the `@objectstack/rest` one — and it **already writes SSE**: two
`text/event-stream` sites with `no-cache` and `keep-alive`, working plumbing an
agent could extend without writing any new transport mechanics. None of the five
`#2992` / ADR-0096 D4 transport tripwires watch it, so a subscribe/fan-out
transport wired there mints no `TRANSPORT-WIRED` key, produces no UNCLASSIFIED
surface and reds no build. The protocol page stated the general limitation ("a
transport wired outside the watched files produces no key and no failure")
without naming the specific already-SSE-capable file sitting inside it.

**This change is a recording. It changes no behaviour**: no probe is added, no
key is minted, and no matrix row is written for the two existing sites.

The reason is recorded because it is the part a reader cannot re-derive cheaply.
Those two `text/event-stream` sites are **per-request AI response streaming, not
realtime subscription fan-out**: each drains one `AsyncIterable` that the route
handler itself returned into that same request's response body and then calls
`res.end()` — the second site's own source comment names its producer as the AI
routes. No subscriber is registered, no event is delivered to a *set* of
recipients, and the file carries no upgrade handler, no subscribe registration
and no realtime-service call. Watching it with the existing mechanics pattern
would therefore mint a key on day one for a surface that is not the hazard
`#2992` is about, leaving only two exits: classify two non-realtime sites in the
matrix vocabulary, or weaken the pattern. Neither is acceptable, so the file
stays out and the boundary is written down instead.

It is written in the two places a reader actually lands. In
`authz-conformance.test.ts` the note closes the tripwire probe list, so a reader
who has just finished enumerating the watched set reads the set's boundary in
the same breath — beside, and explicitly distinguished from, the pre-existing
`#5519` mention of the same file, which is about anonymous gates on the mounted
routes and is a different point. In `realtime-protocol.mdx` it extends the
identity-admission callout at the exact sentence that states the general
limitation.

The exclusion is drawn on **fan-out, not on the SSE content type**, and both
records say so: wiring an upgrade handler, a subscribe registration or a
realtime-service call into that file puts it back inside the hazard while the
recorded boundary still claims otherwise. Promoting it into the tripwire
population with such a fan-out-specific marker is written into #8347's
acceptance as a precondition of the WebSocket/SSE transport landing, so the
design effort is spent when the hazard becomes real rather than now.

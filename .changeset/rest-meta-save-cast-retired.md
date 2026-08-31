---
"@objectstack/rest": patch
---

refactor(rest): the save door call site is compiled against the declared contract (#12004)

The `PUT /meta/:type/:name` door in `packages/rest/src/rest-server.ts` handed
`p.saveMetaItem` a request literal cast `as any`, so the compiler checked
nothing about the ~11 members it built. Unlike the publish door's old cast
(member existence, TS2339) and exactly like the reset twin's (#11679), this
cast was load-bearing on **request shape** alone: `saveMetaItem` is a REQUIRED
protocol member, but the schema declared only `{ type, name, item }`, so
removing the cast surfaced TS2353 on every other key.

With `SaveMetaItemRequestSchema` caught up (the spec half of this landing),
the request is now a named const typed as
`TransportScopedMetaRequest<SaveMetaItemRequest>` — the reset-door spelling,
because this door still spreads the transport-level `environmentId`
(long-standing wire shape, deliberately unchanged; the #9741 ruling keeps it
layered on by the wrapper rather than becoming a protocol key).

**No behaviour change of any kind, and nothing about the wire moves.** The
outgoing payload is byte-identical (same keys, same conditional spreads, same
`writeFace: 'meta-envelope'` server-stated face); the capability gate, the 501
guard, the If-Match / `?force` / `?package` / `?mode=draft` derivations and the
error envelopes are all untouched. An undeclared key in the literal is now a
compile error instead of a payload member no contract has ever seen.

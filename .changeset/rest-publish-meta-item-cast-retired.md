---
"@objectstack/rest": patch
---

refactor(rest): the `publishMetaItem` call site is compiled against the declared contract (#11145)

The `POST /meta/:type/:name/publish` door in `packages/rest/src/rest-server.ts`
reached its protocol method through `(p as any).publishMetaItem` — once for the
501 feature-detection guard, once for the call — so the compiler checked nothing
about the request literal it built. The cast was load-bearing on **member
existence**, not on request shape: #10350 measured that deleting it answered
`TS2339: Property 'publishMetaItem' does not exist on type 'RestProtocol'`, not
a `TS2353` about an unknown key. `publishMetaItem` was an ADR-0076 D9
server-only extension, so no amount of widening the implementation's own
parameter type in `@objectstack/metadata-protocol` (which this package
deliberately does not depend on) could have retired it.

#11006 (maintainer ruling 2026-08-22, option B) declared the member on
`MetadataProtocol` with a `PublishMetaItemRequest`, which is what removes the
prop. The guard is now `if (!p.publishMetaItem)` and the request is a named
const typed `TransportScopedMetaRequest<PublishMetaItemRequest>` — the same
shape #9741 gave the meta-read doors and #9805 gave the non-door helpers.

**No behaviour change of any kind, and nothing about the wire moves.** The
outgoing payload is byte-identical (same keys, same conditional spreads); the
edit hoists the literal into a const and drops a type-level cast. Two things
deliberately survive:

- the 501 feature-detection guard, because the declared member is **optional**
  (a kernel may not implement the promotion door at all) — and it is also what
  narrows the member to callable at the call site;
- the transport-level `environmentId`, which stays layered on by the
  `TransportScopedMetaRequest` envelope rather than becoming a protocol key, per
  the #9741 ruling (2026-08-18).

What the typing buys, measured rather than asserted: an undeclared key in this
request literal is now `TS2353` at compile time instead of a payload member no
contract has ever seen. The docblock that existed only to explain why the cast
had to stay is replaced rather than left behind — a rationale for a prop that no
longer exists is a declaration that outlived its subject.

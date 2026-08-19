---
"@objectstack/rest": patch
---

fix(rest): a missing `auditMetaItem` capability is refused, not answered as "this item has no audit trail" (#9426)

`GET /api/v1/meta/:type/:name/audit` feature-detects `auditMetaItem` on the
resolved protocol. When the method was absent the route answered
`200 { events: [] }` — so a **capability gap** reached the wire as the statement
**"the audit trail was read and this item has no entries"**.

Per ADR-0110 D3 those are different facts, and this one is a **compliance**
surface. The route's own comment says it exists so Studio's 审计日志 / Audit log
tab can show "who tried what and whether a lock blocked it". An empty answer
there reads as *nobody touched this item* — precisely the claim a compliance
reader must not be given on false pretenses.

The branch now refuses:

```
501  { error: { code: 'NOT_IMPLEMENTED',
                message: 'protocol.auditMetaItem() is not available in this kernel' } }
```

— the ADR-0112 nested envelope the sibling `/meta` 501 refusals converged on
(#7035), so `body.error.code` is readable by the same one line of consumer code
that already reads the others. This is the last limb in `rest-server.ts` that
answered a capability gap with a well-formed empty collection; #9326 / PR #9425
fixed the `findReferencesToMeta` twin, and five siblings already refused.

**The unprovisioned-table answer is unchanged, and the two were never the same
path.** The route's header comment promises "Empty array on environments where
the table is not yet provisioned" — that condition is handled one layer down, in
`ObjectStackProtocolImplementation.auditMetaItem`, whose `catch` returns
`{ events: [] }` after a `console.warn`. That path requires the method to exist
and to be called; this branch returns before the call. Separate frames, separate
packages.

**Does any caller's observed response change? Yes, on one deployment shape, and
only there.** A protocol that *has* the method is untouched: an empty trail and a
populated one both still pass through verbatim as `200`. What changes is the
answer given when the protocol has no such method — previously `200` with an
empty list, now `501`. No assembly in this repo produces such a protocol today:
`ObjectStackProtocolImplementation` is the only implementation registered under
the `protocol` service and it defines the method unconditionally. The branch is
reachable rather than dead because `auditMetaItem` is **not** a member of
`RestProtocol` (`= DataProtocol & MetadataProtocol`) and is not declared in
`@objectstack/spec` at all — it is an ADR-0076 D9 server-only extension reached
through a runtime cast. A host that implements the declared contract exactly, or
that points `protocolServiceName` at its own service, is a *conforming*
deployment that lands on this branch with no type error.

Refusing at the route rather than asserting at assembly is deliberate: a
boot-time assertion would promote an undeclared optional extension into a
required one, which is a contract decision for `@objectstack/spec` rather than a
route one, and it would reject the partial protocol doubles that legitimately
exist today.

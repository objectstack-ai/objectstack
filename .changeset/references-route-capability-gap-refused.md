---
"@objectstack/rest": patch
---

fix(rest): a missing `findReferencesToMeta` capability is refused, not answered as "nothing depends on this item" (#9326)

`GET /api/v1/meta/:type/:name/references` feature-detects `findReferencesToMeta`
on the resolved protocol. When the method was absent the route answered
`200 { references: [] }` — so a **capability gap** reached the wire as the
statement **"nothing depends on this item"**.

Per ADR-0110 D3 those are different facts, and here they have opposite
consequences. The consumer is the admin "Used by" panel, whose empty state reads,
verbatim from `objectui`'s `metadata-admin/i18n.ts`:

```
'engine.edit.refsEmptyDesc': 'Nothing in the metadata graph points at this item. Safe to delete.'
```

An operator about to delete something was shown that sentence on a deployment
where the question had never actually been asked.

The branch now refuses:

```
501  { error: { code: 'NOT_IMPLEMENTED',
                message: 'protocol.findReferencesToMeta() is not available in this kernel' } }
```

— the ADR-0112 nested envelope the sibling `/meta` 501 refusals converged on
(#7035), so `body.error.code` is readable by the same one line of consumer code
that already reads the others.

**Does any caller's observed response change? Yes, on one deployment shape, and
only there.** A protocol that *has* the method is untouched: both an empty and a
non-empty result still pass through verbatim as `200`. What changes is the
answer given when the protocol has no such method — previously `200` with an
empty list, now `501`. No assembly in this repo produces such a protocol today:
`ObjectStackProtocolImplementation` is the only implementation registered under
the `protocol` service and it defines the method unconditionally. The branch is
reachable rather than dead because `findReferencesToMeta` is **not** a member of
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

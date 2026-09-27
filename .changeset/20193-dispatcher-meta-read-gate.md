---
'@objectstack/runtime': patch
'@objectstack/rest': minor
---

fix(runtime): the dispatcher's `/meta` item reads ask the same per-caller read gate `RestServer` asks, and `@objectstack/rest` publishes it (#20193)

`GET /meta/:type/:name` and `GET /meta/:type/:name/published` have two
implementations: `RestServer`, and the runtime dispatcher's `/meta` domain. On a
host that mounts only the `${prefix}/*` catch-all (`@objectstack/hono`'s
`createHonoApp`, the documented embed shape, and any adapter built on the public
`HttpDispatcher` API), the dispatcher is the only one that answers. Its item read
and its `/published` read applied **no** per-caller read gate. An authenticated
member who does not hold `crm_admin` got these answers through `dispatch()`:

```
request                                   before                after (= RestServer)
GET /meta/doc/crm_admin_runbook           200 + the gated body  403 PERMISSION_DENIED
GET /meta/doc/crm_admin_runbook/published 200 + the gated body  403 PERMISSION_DENIED
GET /meta/book/admin_guide (set-gated)    200 + the book        403 PERMISSION_DENIED
GET /meta/app/crm  (and /published)       200, every entry      200, pruned
GET /meta/app/payroll (app-level perms)   200                   403 PERMISSION_DENIED
GET /meta/app/launchpad (unpublished)     200                   404, the same body as a missing name
GET /meta/dashboard/ops                   200, every widget     200, minus the widget whose service is off
GET /meta/object/invoice/published        200, every field      200, the ADR-0106 mask applied
```

Holders are still served in full. Object reads through the plain item read are
masked as before. An anonymous caller still gets `401 UNAUTHENTICATED`.

**One gate, not two.** `RestServer`'s gate moved unchanged into
`packages/rest/src/meta-item-read-gate.ts`. That covers the ADR-0046 §6.7 docs
audience, the app nav filter (`requiredPermissions`, the ADR-0045 §3 publish gate
and the docs-audience entry arm), the ADR-0057 D10 service gates and the #7912
servability gate. Both transports now call it. Each transport supplies only its
own I/O (the caller, the protocol's list read, the security service and a
service probe) and writes the gate's data verdict in its own envelope. There is
no second audience resolver in `packages/runtime`. `RestServer` keeps its
private helper names as delegates, so its own answers are byte-for-byte
unchanged.

A gate input that cannot be read is answered as that fault, never as the
document. This covers a books or doc-list read that throws, and a host whose
protocol has no list read at all (fail closed, ADR-0049).

`@objectstack/rest` adds these exports: `createMetaItemReadGate` and the types
`MetaItemReadGateSources`, `MetaItemReadVerdict`, `MetaItemReadRefusal`,
`MetaReadGateCaller` and `MetaReadGatePolicy`. Nothing is removed or renamed,
and no authorable key moves.

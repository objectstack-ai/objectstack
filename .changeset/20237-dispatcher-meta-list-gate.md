---
'@objectstack/runtime': patch
'@objectstack/rest': minor
---

fix(runtime): the dispatcher's `/meta/:type` list prunes what `RestServer`'s list prunes, through one list gate that `@objectstack/rest` publishes (#20237)

Clause-②: yes

`GET /meta/:type` has two implementations: `RestServer`, and the runtime
dispatcher's `/meta` domain. On a host that mounts only the `${prefix}/*`
catch-all (`@objectstack/hono`'s `createHonoApp`, the documented embed shape,
and any adapter built on the public `HttpDispatcher` API), the dispatcher is the
only one that answers. Its list branch applied **no** per-caller filter. An
authenticated member who does not hold `crm_admin` got these answers through
`dispatch()`:

```
request                         before                                     after (= RestServer)
GET /meta/doc?include=content   the set-gated doc listed WITH its body     the doc left out
GET /meta/book                  the set-gated book listed                  the book left out
GET /meta/app                   an app whose requiredPermissions the       that app left out; the other app
                                member lacks, and an ungated app with      pruned of its gated entry
                                its requiredPermissions-gated entry
GET /meta/dashboard (anyone)    every widget                               minus the widget whose service is off
```

The plural spellings (`/meta/docs`, `/meta/books`, `/meta/apps`) answer the
same. Holders are still listed everything in full. Object lists are masked as
before. An anonymous caller still gets `401 UNAUTHENTICATED`.

**One gate, not two.** `RestServer`'s list filters moved unchanged into
`createMetaListReadGate`, beside the item gate in
`packages/rest/src/meta-item-read-gate.ts`. It covers the ADR-0046 §6.7 doc
and book audience prunes, the app nav filter (`requiredPermissions`, the
ADR-0045 §3 publish gate and the docs-audience entry arm) and the ADR-0057
D10 dashboard widget gate. `RestServer`'s list route and the dispatcher's list
branch both call it, over the same ports the item gate takes, and each rewraps
the pruned items in its own list envelope. There is no second audience
resolver in `packages/runtime`. `RestServer`'s list answers are unchanged.

Every exit of the dispatcher's list branch now runs the gate and the ADR-0106
object mask: the protocol list and the two fallbacks, the runtime metadata
service's list and the ObjectQL registry. The fallbacks used to serve
unmasked object schemas as well as ungated docs, books and apps. A gate input
that cannot be read (a doc list's books read throws) is answered as that fault,
never as the unfiltered list.

**`@objectstack/rest`'s published export surface widens**, and that is why this
changeset declares `Clause-②: yes`. Its only export subpath (`.`) gains one
value:

- `createMetaListReadGate(sources, metaType)`: the list gate. It takes the
  same `MetaItemReadGateSources` the item gate takes, and it answers a judge
  from a list's items to the items this caller may be served.

It is public because the runtime dispatcher's `/meta` domain in
`@objectstack/runtime` consumes this one gate. `@objectstack/rest` cannot import
the runtime, so the shared decision has to live here and travel as an export,
the way `createMetaItemReadGate` does. A caller outside the platform does not
need it.

Nothing is removed or renamed from the package's exports, and no authorable key
moves. The dispatcher's prunes are not the widening: they pull a second
transport back to the rules the contract already declares (ADR-0046 §6.7,
ADR-0045 §3, `apps.mdx`'s `requiredPermissions` row), which is why
`@objectstack/runtime` stays a `patch`.

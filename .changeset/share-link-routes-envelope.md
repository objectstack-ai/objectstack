---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing)!: the share-link routes emit the declared envelope, and the last ratchet retires (#3983)

The fifth and final drifting route module. Unlike the four in #3843, this one was
not found by reading — `scripts/check-route-envelope.mjs` surfaced it the moment
that scan went repo-wide, which is the whole argument for a repo-wide guard over
per-package copies. It also turned out to be the one where the drift had actually
**broken shipped SDK methods**, not merely mis-shaped a body.

## Two SDK methods did not work on this surface

Three of these routes are `disposition: 'sdk'` in `runtime/src/route-ledger.ts`,
and `ObjectStackClient.unwrapResponse` decides a body is an envelope by finding a
boolean `success`. With no flag it hands back the body verbatim:

| method | documented / typed as | actually returned |
|---|---|---|
| `shareLinks.create()` | "the link row (incl. `token`)" | `{ link: … }` — so `.token` was `undefined` |
| `shareLinks.list()` | `Promise<any[]>` | `{ links: [] }` — so `.map()` threw |

`packages/client/src/admin-surfaces.test.ts` mocks all three as
`{ success: true, data: <payload> }`. The SDK was written and tested against the
**dispatcher's** shape and only ever worked there.

## This is a convergence, not a redesign

`runtime/src/domains/share-links.ts` serves the same five paths, and for cloud's
per-environment kernels it is the *designed primary* surface
(`registerShareLinkRoutes: false`). It has always answered in the declared
envelope. The plugin now answers identically:

| route | was | now |
|---|---|---|
| `POST /share-links` | `{ link }` | `{ success: true, data: link }` |
| `GET /share-links` | `{ links }` | `{ success: true, data: link[] }` |
| `DELETE /share-links/:idOrToken` | `{ ok: true }` | `{ success: true, data: { ok: true } }` |
| `GET /:token/resolve` | `{ record, link, redactFields }` | `{ success: true, data: { … } }` |
| `GET /:token/messages` | `{ data: rows }` | `{ success: true, data: rows }` |
| errors | `{ error: { code, message } }` | `{ success: false, error: { … } }` |

`data` carries each payload **directly** — `data: links`, not `data: { links }`.
That is what makes `unwrapResponse` return the same value on both surfaces, and
it is what the SDK already expected.

## Breaking: raw `fetch` callers add one hop

SDK callers get the fix for free (two of them go from broken to working). Direct
body readers add `.data`:

```diff
- const { links } = await (await fetch('/api/v1/share-links')).json();
+ const { data: links } = await (await fetch('/api/v1/share-links')).json();
```

`{ ok: true }` on revoke survives, but as the payload rather than as the body: at
the top level it was a second word for `success`, which #3689 retired from
storage; under `data` it is what the dispatcher already returned.

The `error` half was already nested `{ code, message }` — #3675's changeset cited
this module as the good example of that — so only the `success` flag is new there.
All eleven codes were already SCREAMING_SNAKE and registered, so ADR-0112 needs
nothing.

## Consumers

Swept, and the result is smaller than #3983 assumed. The framework has **zero**
consumers of these routes. In objectui, `ShareDialog` was already dual-shape
tolerant on all three routes it calls (`body.links ?? body.data`,
`created.link ?? created.data`, and revoke never reads the body) — it needs no
change, and it carried that tolerance precisely *because* both shapes existed in
the fleet.

`SharedRecordPage` did need one fix, and it is the kind a shape-swap would have
missed: it renamed the wire's `redactFields` to `redactedFields` only on the
*bare* branch, so on the already-enveloped dispatcher path the "fields are hidden
by the owner" notice never rendered. Converting this surface would have spread
that to every share page. Fixed in objectui#2980, which merges first.

## Guard

**7 conformant / 0 ratcheted / 1 exempt**, from 6 / 1 / 1. The ratchet mechanism
stays for the next module that needs it.

`privateOk` also got narrowed to what its own doc always claimed — a literal `ok`
at the **top** of a body, where it competes with `success`. The same literal
inside `data` is payload, which is what a conformant revoke returns. Four
self-test assertions pin both readings.

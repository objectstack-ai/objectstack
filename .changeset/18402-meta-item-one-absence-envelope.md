---
"@objectstack/rest": patch
---

fix(rest): `GET /meta/:type/:name` answers absence in ONE envelope, whichever arm produced it (#18402)

`patch` — a bug fix in a released package. No exported symbol added to the
package entry, no spec or ADR edit, no authorable key touched.
`Clause-②: no` — the contract surface (`packages/spec`) is not in this diff, and
nothing an author can write changes.

## What was wrong

#18066 gave this route ONE absence emitter and reached it from the two
conditions that RETURN nothing. The conditions that THROW one were left on the
classification door, which renders the flat `{ error: '<message>', code }`. So
`body.error.code` — the accessor #8013 settled on and objectui#4252 reads — was
`undefined` on exactly those, and **which envelope a caller had to parse for an
absence was decided by two things it cannot see**:

- `metadata.enableCache`, which **defaults to `true`**. The cached arm's
  `getMetaItemCached` throws `metadataItemNotFoundError` on a falsy `item`; the
  uncached arm resolves item-less and returns.
- which protocol implementation is mounted. The in-repo `metadata-protocol`
  resolves item-less from `getMetaItem`; a protocol that throws the miss reached
  the same flat door.

Re-measured on `origin/main` at `551139bb7` rather than copied from the report —
the same absent `view`, driven through both arms:

| arm | status | body |
|:--|--:|:--|
| uncached, item-less return | 404 | `{"error":{"code":"RESOURCE_NOT_FOUND","message":"Metadata item not found or access denied."}}` |
| cached, producer throws | 404 | `{"error":"Metadata item view/no_such_view not found","code":"RESOURCE_NOT_FOUND"}` |

Same route, same status, same code, two envelopes — and the flat one echoed the
type and the name where the emitter says one fixed sentence.

## What it does now

Both arms reach `sendMetaItemAbsent`. The route's absence answer is one body:

```
404 {"error":{"code":"RESOURCE_NOT_FOUND","message":"Metadata item not found or access denied."}}
```

⭐ This **strengthens** the ADR-0045 §3 property rather than merely preserving
it. The unpublished app and the service-gated one already answered through the
emitter, so an absence that kept the thrown dialect was a response pair that
told them apart — by envelope shape, and by the producer's prose. Byte-identity
across all of them is now pinned on the SERIALIZED body, not on object equality.

## ⛔ What it deliberately does NOT do

- **It is not "every 404 is absence."** `NO_DRAFT` is a 404 on this same route —
  the Studio designer's `?state=draft` probe — and it says the item IS there and
  its draft is not. Folding it in would tell a designer the object does not
  exist: #5532's flattening, reintroduced by the repair for a sibling of it. A
  producer-declared code the ADR-0112 ledger does not know keeps its
  `declaredCode` for the same reason, and a producer that declared NO code gets
  none invented for it.
- **It does not converge the flat dialect itself.** The ADR-0046 audience gate's
  `sendDeclaredFault` 401/403 beside this, and the door in `error-response.ts`,
  still answer flat. That envelope POSITION is the live ratchet **#9559** owns
  repo-wide (`check:route-envelope`); converting two of its four emissions here
  would mint a new divergence — the same refusal answering two shapes depending
  on which ROUTE served it.

## What moves for consumers

A caller that branched on `body.code` for this route's **absence** reads
`body.error.code` now. ⚠️ No caller could have had a working dependency on the
flat shape here: it was already nondeterministic from the caller's side, decided
by a server setting and by which protocol was mounted, and the default
deployment's uncached arm answered the nested shape all along. Every other
refusal on this route — 400, 401, 403, `NO_DRAFT`'s 404, 503 — is byte-identical
to before.

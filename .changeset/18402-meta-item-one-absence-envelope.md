---
"@objectstack/rest": minor
---

fix(rest)!: `GET /meta/:type/:name` answers absence in ONE envelope, whichever arm produced it (#18402)

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes is retired, renamed or given a new meaning here: no metadata key, no spec schema, no `packages/spec` file is in this diff, and no stored `sys_metadata` document changes shape or content. The only thing that moves is the WIRE BODY of one REST refusal — the absence answer of a single read route — which is not an ADR-0087 surface at all, so `objectstack migrate meta` has nothing it could rewrite and there is no registry entry for this to be missing. Judged against this diff's own facts: the six changed files are `packages/rest/src/{rest-server,error-response}.ts`, three `packages/rest` pin tests and one `packages/qa/dogfood` pin test. -->

Clause-②: no

The contract surface (`packages/spec`) is not in this diff; no authorable key, no closed-set member, no published export and no registry entry moves.

## What was wrong

#18066 gave this route ONE absence emitter and reached it from the two conditions that RETURN nothing. The conditions that THROW one were left on the classification door, which renders the flat envelope — a string `error` beside a top-level `code`. So `body.error.code` — the accessor #8013 settled on and objectui#4252 reads — was `undefined` on exactly those, and **which envelope a caller had to parse for an absence was decided by two things it cannot see**:

- `metadata.enableCache`, which **defaults to `true`**. The cached arm's `getMetaItemCached` throws `metadataItemNotFoundError` on a falsy `item`; the uncached arm resolves item-less and returns.
- which protocol implementation is mounted. The in-repo `metadata-protocol` resolves item-less from `getMetaItem`; a protocol that throws the miss reached the same flat door.

Re-measured on `origin/main` at `551139bb7` rather than copied from the report — the same absent `view`, driven through both arms:

| arm | status | body |
|:--|--:|:--|
| uncached, item-less return | 404 | `{"error":{"code":"RESOURCE_NOT_FOUND","message":"Metadata item not found or access denied."}}` |
| cached, producer throws | 404 | `{"error":"Metadata item view/no_such_view not found","code":"RESOURCE_NOT_FOUND"}` |

Same route, same status, same code, two envelopes — and the flat one echoed the type and the name where the emitter says one fixed sentence.

## What it does now

Both arms reach `sendMetaItemAbsent`. The route's absence answer is one body:

```
404 {"error":{"code":"RESOURCE_NOT_FOUND","message":"Metadata item not found or access denied."}}
```

⭐ This **strengthens** the ADR-0045 §3 property rather than merely preserving it. The unpublished app and the service-gated one already answered through the emitter, so an absence that kept the thrown dialect was a response pair that told them apart — by envelope shape, and by the producer's prose. Byte-identity across all of them is now pinned on the SERIALIZED body, not on object equality.

## **BREAKING** — the default wire answer moves for non-`app` types

**BREAKING** in the accept-set sense, landing in the launch window as `minor` (the lockstep convention: `major` is refused by `check-changeset-no-major`, and breaking-ness is carried by this banner plus the ADR-0087 disposition above).

What breaks: on `GET /meta/:type/:name`, the **absence** refusal moves from the flat top-level `code` to the nested `error.code`. ⚠️ For every type that does **not** bypass the cache — `object`, `view`, `flow`, `page` and the rest — this is the **default** answer, not a minority path: `metadata.enableCache` defaults to `true`, so those types took the cached arm and the cached arm threw. Measured in this repo against a real booted app: the showcase declares no `enableCache`, and its dogfood pin on `GET /meta/object/:name` was reading the flat `body.code` — a real consumer, in-tree, depending on the flat shape for exactly this refusal.

Only `app` (and `dashboard`, `doc`, `book`, `?state=draft`, `?preview=draft`, `?package=`) bypassed the cache and already answered the nested shape.

**The remedy is one accessor.** Read `body.error.code` instead of `body.code` on this route's 404. Nothing else about the refusal moves: the status is still `404`, the code is still `RESOURCE_NOT_FOUND`, and the message is the emitter's fixed sentence rather than the producer's. `ObjectStackClient` normalizes both envelopes already, so SDK callers are unaffected.

## ⛔ What it deliberately does NOT do

- **It is not "every 404 is absence."** `NO_DRAFT` is a 404 on this same route — the Studio designer's `?state=draft` probe — and it says the item **is** there and its draft is not. Folding it in would tell a designer the object does not exist: #5532's flattening, reintroduced by the repair for a sibling of it. A producer-declared code the ADR-0112 ledger does not know keeps its `declaredCode` for the same reason, and a producer that declared NO code gets none invented for it.
- **It does not converge the flat dialect itself.** That envelope POSITION is the live ratchet **#9559** owns repo-wide (`check:route-envelope`); converting two of `sendDeclaredFault`'s four emissions here would mint a new divergence — the same audience refusal answering two shapes depending on which ROUTE served it.

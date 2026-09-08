---
"@objectstack/driver-sql": minor
---

`SqlDriver`'s object-definition parameters now DECLARE every key they read. `initObjects` accepts `lifecycle`, and the whole rotation chain — `rotateShards`, `ensureRotation`, `ensureShardTable` — accepts `tenancy` and `indexes`, spelled as a **fresh object literal** rather than only as a value bound to a variable first.

The driver read those keys off caller objects all along, through `(obj as any).<key>`, while the parameter's own inline type listed none of them. That is refused or accepted depending only on where the object is spelled: TypeScript's excess-property check fires on a fresh literal and not on one hoisted to a variable, so the same call compiles in one shape and is `TS2353` in the other. The loud outcome is the harmless one. The bad one is an author — or an AI reading the signature — concluding the key is not accepted and DROPPING it, at which point a declared UNIQUE is never synced and an ADR-0057 rotation policy is never armed, with nothing anywhere saying so.

This is the third instance of one class, not a third coincidence: `tenancy` (#4311) and `indexes` (#16570) were the first two, each fixed one key at a time. The class is now held by a gate — `scripts/check-object-def-param-keys.mjs` — that reads parameter lists as an AST and covers the shape no in-file check could see: a subclass in another published package overriding one of these methods with a narrower literal.

- **What widened.** `rotateShards(objectDef)` gains `tenancy?: any` and `indexes?: any[]`; `ensureRotation(…, obj, …)` gains the same two; `ensureShardTable(…, obj)` gains `indexes?: any[]`; `initObjects(objects)` gains `lifecycle?: any`. All three rotation links carry the keys, not just the leaf that reads them — declaring them only on the leaf would leave the two links above still narrowing the same value in flight, so a fresh literal handed to the public entry point would still have been refused.
- **What did NOT widen, deliberately.** The accept set still has a boundary: a misspelling (`indexs`, `tenancyy`, `lifecycl`) on a fresh literal is still `TS2353`, pinned by `@ts-expect-error` in `src/sql-driver-16711-object-def-param-keys.test.ts`. A "fix" that relaxed these parameters to `any`, or gave them an index signature, would have turned every other assertion green while deleting the entire layer of protection.
- **Four `as any` casts deleted**, including the residual one in `detectManagedDrift`, whose parameter had declared `indexes` all along. Behaviour is unchanged in every case — the keys were already being read.

---
"@objectstack/rest": patch
---

fix(rest): `POST /api/v1/batch` answers the same thing for a wired-and-failing engine on every wiring — 503, the answer this slot's two other consumers already give (#18559)

`objectQLProvider` has three consumers in `packages/rest/src/rest-server.ts`. Two reach the
seam through `wiredEngineOrLoud`, which keeps "no engine is wired" and "the engine WAS wired
and could not be resolved" as two facts. The cross-object batch door read the field directly,
so a rejection escaped the read, missed the adjacent `501 NOT_IMPLEMENTED` arm (it tests
`!ql || typeof ql.transaction !== 'function'`, which a rejection never reaches) and landed in
the handler's generic outer `catch`.

⛔ **Not a re-collapse and not a regression.** The two facts always differed on the wire, so
the decidable test #14251 tightened was already satisfied at this consumer. What was wrong is
that they differed *through a catch-all that knows nothing about this seam*.

**What moves, measured on a real `RestServer` over a real `ObjectKernel`, driven at the door:**

| wiring, engine wired and FAILING | before | after |
|:--|:--|:--|
| single-kernel (the composition the open core boots) | 503 `SERVICE_UNAVAILABLE` | 503 — unchanged |
| multi-kernel (a `kernelManager` is wired) | **500 `INTERNAL_ERROR`** | **503 `SERVICE_UNAVAILABLE`** |

⭐ The single-kernel row is why this is a de-divergence rather than a new wire ruling: there
`computeExecCtx` resolves the engine through its own `wiredEngineOrLoud` branch and raises
before the batch handler's engine line runs, so this door already answered 503. The 500 was
reachable only where that gate's kernel branch absorbs by design and hands the engine question
down. An operator got one of two answers for one fact depending on which composition was
running — and 500 and 503 are not synonyms to a client: one says "I am broken", the other says
"I am temporarily unavailable, retry".

**Unchanged, and pinned:** both ABSENCE shapes still answer `501 NOT_IMPLEMENTED` on both
wirings — no provider wired at all, and a provider that RESOLVES `undefined`, which is the
seam contract declaring absence rather than failing. The fault MESSAGE is still withheld
(`Internal server error`); only the status and the machine code move. `SERVICE_UNAVAILABLE` is
an existing `StandardErrorCode` already emitted by the sibling `/meta/object/:name/state/:field`
door for this same fact — no new code, no new payload key, no new export.

---
'@objectstack/objectql': minor
---

fix(objectql): the flat-input proxy REFUSES a symbol key at `set`/`defineProperty` instead of silently persisting it (#12603)

**Bump level, argued**: `minor`, not `patch`. Every sibling in this family (#12277,
#12397, #12578, #12601) shipped `patch` because each closed an instrument
DISAGREEMENT — the accepted set of writes never changed, only which read-back
told the truth about them. This card is different in kind: `ctx.input[sym] =
value` and `Object.defineProperty(ctx.input, sym, …)` **used to succeed**, and
now **throw**. That is a narrowing of the accept set on `ctx.input` — a surface
every hook body touches — which is the exact shape `8cc8401`
(`@objectstack/objectql` 17.2.0, "BREAKING (accept-set tightening)") argued
`minor` for under this repo's launch-window convention (pre-1.0 semantics: a
breaking change does not burn a major version while the stack versions in
lockstep — see `scripts/check-changeset-no-major.mjs`). `patch` here would
under-declare a change that can turn a passing hook into a throwing one.

**What changed.** `installFlatInput`'s `set` and `defineProperty` traps
(`packages/objectql/src/hook-wrappers.ts`) now refuse a symbol-keyed write with
a `TypeError` naming the key kind and the surface, instead of routing it into
the record payload (`data`) the way every string-keyed write is routed.
Measured on the pre-fix tree: a symbol-keyed `set` succeeded silently, the
value reached `data` and persisted to the row the engine stores, and only
`Object.getOwnPropertySymbols` / `Reflect.ownKeys` omitted it from enumeration
— two instruments said "own", enumeration said "no", while the persisted row
held it regardless.

**Why a refusal, not a fourth instrument fix.** Maintainer ruling, 2026-08-27
(Option C, refusal arm), on the payload-contract question #12578 measured and
deliberately left open rather than decided: a record payload is a declarable,
**string-keyed** field set — no metadata schema can declare a symbol field, so
a symbol key on this surface is a JS-runtime artifact leaking toward storage,
not a legal payload field. Option B (publish symbols too, via
`Reflect.ownKeys`) was declined — it would have made an undeclarable key kind a
published contract instead of closing the question. Hiding a key the engine
nonetheless persists is precisely the shape #12277/#12397/#12578 exist to
abolish; refusing the write at the boundary closes that gap from the other
side, before persistence rather than after enumeration.

`ownKeys` itself is **untouched** — still `Object.getOwnPropertyNames(data)`,
exactly as #12578 landed it. With the write refused, `data` can never carry a
symbol key for that trap (or `Reflect.ownKeys`) to disagree about, so there is
nothing left for this card to change there.

**Migration.** Code that wrote a symbol key onto `ctx.input` — almost always by
accident, e.g. spreading an object that carried a symbol-keyed cache entry onto
the payload — now throws instead of silently losing the write to enumeration.
Use a string key, or keep the value off the payload entirely (a local
variable, or a WeakMap keyed by the record) if it was never meant to be
stored. No other hook-input read/write path changes: reads, `has`, `delete`,
and every string-keyed write behave exactly as before.

Inverts the pin `hook-input-ownkeys-agreement.test.ts` carried OPEN since
#12578 (the disagreement, deliberately left standing) into a REFUSAL pin
(the write throws, nothing persists) — the same case, turned around in place,
not a second assertion stacked beside the first.

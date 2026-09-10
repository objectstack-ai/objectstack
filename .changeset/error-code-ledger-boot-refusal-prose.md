---
"@objectstack/spec": patch
---

The error-code ledger's TSDoc stops naming a retired verdict as a live mechanism, and states the published-face rule it is actually held to.

`packages/spec` ships `src/**/*.zod.ts`, so `api/error-code-ledger.zod.ts`'s header is published prose — a consumer reads these sentences out of the tarball. Two of them stopped being true when `check-dispatcher-error-vocabulary`'s face refusal widened from `packages/spec/src/**` to every published package's `src/` and the dispatcher vocabulary's `boot-refusal` verdict retired with it (#16649).

The first said the `boot-refusal` verdict **records** reachability for codes not yet registered, and pointed at the module the verdict was being deleted from. That is a claim about where a live mechanism lives, not about a case that can no longer arise, so a reader following the pointer would have found nothing. It now records the retirement and names what replaced it: a `door: 'none'` code has no resting place short of a row in the ledger.

The second opened `packages/spec/src/** is held to this mechanically`. True before the widening and an understatement after it — a reader would conclude only the spec tree is guarded, which is the "guarded a part" / "guarded it" confusion this whole class of gate exists to remove. It now states the published face, the stricter spec sub-face where `pending-registration` has no allowance, and the named, dated allowance outside it owed to #8846, with both finding kinds named.

No schema, accept set, default or refusal moves. `ERROR_CODE_LEDGER` holds the same members before and after, and the generated reference page is regenerated from this prose rather than hand-edited.

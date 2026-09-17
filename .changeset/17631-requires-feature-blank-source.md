---
'@objectstack/spec': patch
---

fix(spec): `requiresFeature` refuses a blank-`source` CEL `visible` instead of composing a predicate that can never parse (#17631)

Clause-②: no

`lowerRequiresFeature` lowers the `requiresFeature: '<flag>'` sugar into the canonical `visible` CEL predicate, and its own docblock states the ADR-0078 rule it enforces: a composition that could never take effect is a loud parse error, not a silent one. The guard that enforced it tested the TYPE of `source` (`typeof existing.source !== 'string'`), so a whitespace-only `source` — legal on `ExpressionSchema`, which is the persistence contract and whose `min(1)` whitespace clears — passed it and the gate was composed AROUND a blank operand:

```
visible: { dialect: 'cel', source: '   ' } + requiresFeature: 'organization'
  →  { dialect: 'cel', source: '(   ) && features.organization != false' }
```

That predicate parses on no scope at all (`celEngine.evaluate` answers `kind: parse`, `Unexpected token: RPAREN`), so at render the gate faults instead of gating: fail-soft surfaces show the element regardless of the flag, fail-closed surfaces hide it regardless of the flag. Either way the flag decides nothing — the parses-clean-changes-nothing arrival the guard exists to reject, produced by the guard's own composition step.

The lowering now refuses a `source` that is blank after trimming, on the same leg as the AST-only refusal one line above, with a refusal that names the composition it would have produced and both exits (drop the blank `visible` and the sugar emits the gate alone; or write the predicate the gate should compose with). The notion of blank is `source.trim()` — the one the engine's own helpers apply — so a `source` that is merely padded around real text still composes verbatim.

- **Refused at the producer, not tolerated at a consumer.** No renderer gains a fallback for the unparseable predicate; the lowering stops emitting it.
- **Both slots that compose the sugar inherit it** — `ActionSchema.visible` and `ActionParamSchema.visible` — because the rule lives in the shared lowering rather than in either slot's declaration.
- **`ExpressionSchema` / `ExpressionInputSchema` are NOT narrowed.** They remain the persistence contract, and a blank-`source` `visible` with no `requiresFeature` beside it still parses exactly as before. What is refused is the COMPOSITION, which is the thing that could never work.
- **Nothing that functioned stops functioning.** The only authoring this refuses is one whose output faulted at CEL parse on every scope, so the migration is the refusal's own prescription and there is no working shape to port.

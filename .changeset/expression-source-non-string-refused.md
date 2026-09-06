---
"@objectstack/formula": minor
---

`validateExpression` now refuses a non-string expression `source` through `errors[]`, instead of throwing a raw `TypeError` that wiped out the caller's located reporting.

`validateExpression(role, input)` accepts `string | { dialect?, source? }`, and read the envelope's `source` unguarded — `if (!source.trim())`. `ExprInput` declares `source?: string`, but every production call site casts, because the value comes out of **metadata**, where a declaration is a claim about stored data and not a guarantee about it. An envelope whose `source` was present and not a string therefore threw `TypeError: source.trim is not a function` out of a validator whose own docblock promises it never throws.

**The defect was not "it throws" — it was that it threw the wrong kind and bypassed a whole located-reporting contract.** `AutomationEngine.validateFlowExpressions` collects located findings and throws one assembled error naming the flow, the node, the slot and the source (ADR-0032 §1d); `@objectstack/lint`'s stack walk attributes every finding to the hook, sharing rule, action or field it came from. An exception raised *inside* the shared validator skipped both, so the author was handed an internal message naming none of them. Measured before the fix, on a stack whose `hooks[].condition` was `{ source: { nested: 1 } }`: the whole `objectstack validate` run died on `source.trim is not a function`. After: one located `error` reading ``hook 'gate_hook' (lead) condition``.

The guard sits at `toSource`, the entry `validateExpression` and `inferExpressionType` share — **once**, not in each caller's own `try`/`catch`, which is the tolerant-consumer shape Prime Directive #12 forbids. `validateExpression` returns `ok: false` with one `ExprValidationError` naming what was found and both authorable forms; `inferExpressionType` answers `'unknown'`, its existing "cannot prove a type".

**No exported symbol or signature moves** — measured by diffing the built `dist/index.d.ts` before and after: 39 exported declarations on both sides, and `validateExpression`'s declaration byte-identical. What changes is behaviour at a published entry, which is why this is `minor` rather than `patch`: an input that previously produced **no verdict at all** now produces a rejection.

**What does not change.** Absent, `null`, empty and whitespace-only sources still read as "not authored" (`ok: true`), an `{ ast }` envelope carrying no `source` is still admitted (its admission is `ExpressionSchema`'s rule, not this entry's), and a malformed *string* still gets its own diagnostic — the brace trap, the dialect mismatch, the unknown function — never the shape refusal. No input that previously returned `ok: true` now returns `ok: false`, and none that returned `ok: false` now returns `ok: true`.

A caller that relied on catching the `TypeError` would need to read `result.ok` instead. None does: all nine production call sites (`@objectstack/lint` ×4, its docs gate ×2, `@objectstack/service-automation` ×3) read `.errors`/`.warnings` directly, and the one call site inside a `try` (`@objectstack/mcp`'s `validate_expression` tool) has a handler-level catch that degrades to an error result and declares its `expression` parameter `z.string()`.

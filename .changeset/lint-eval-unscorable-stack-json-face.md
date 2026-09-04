---
"@objectstack/cli": patch
---

`os lint --eval --json` reports an unscorable generated stack as a failed case instead of crashing with no JSON at all.

The eval harness promised totality in writing — *"Never throws — generation failures become failed cases"* — and the promise was false as written. Its `try` wrapped only the call to your `--generator` module; the `scoreMetadata(stack)` call that follows sat outside it. So a generator that **threw** became a failed case, exactly as documented, while a generator that **returned** a value nobody could walk took the whole process down:

```
os lint --eval --json --generator ./g.mjs
exit 1 · stdout 0 bytes · stderr "    Error: poison getter"
```

A caller that asked for `--json` got the framework's human error text on stderr and no document at all to parse. Eval mode dispatches above the project-lint `try`, so the catch-all JSON exit that mode has could never see it either.

Scoring a stack means walking it, and there are two walks: the normalizer spreads the stack's top level, and the schema parse walks everything below it. A throw from **either** now becomes that case's `generationError` — the same per-case channel a throwing generator already used — so the report exit that was always there emits its JSON, names the cause, and still exits non-zero:

```json
{ "id": "invoice_with_line_items",
  "generationError": "Failed to score the generated stack: poison getter",
  "passed": false,
  "score": { "score": 0, "grade": "F", "valid": false } }
```

Nothing new appears on the `--json` face: no new key, no new payload shape. The failing exit was already reachable for a throwing generator; it is now reachable for a poisonous one too.

The failed case is scored `0 / F / valid: false` rather than as an empty stack. An empty stack scores 100 / A / valid, and stamping that on a stack nobody could parse would have put a clean-looking verdict next to a failure — the crash replaced by a quiet wrong answer.

Unchanged: offline mode, and every off-shape stack a generator can return. Bad metadata is still **scored**, with its schema errors as the reason it fails — it is not rerouted into the failure channel.

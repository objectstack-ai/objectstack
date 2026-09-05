---
"@objectstack/cli": patch
---

`os lint --eval` no longer scores a failed generation as a perfect one: a generator that throws now counts 0 toward `meanScore` instead of 100.

The harness has always handled a throwing `--generator` by substituting an empty stack and scoring that. An empty stack is **100 / grade `A` / `valid: true`** — it has nothing wrong with it because it has nothing in it. So a live eval in which every single generation failed reported the best possible headline number:

```
os lint --eval --json --generator ./throws.mjs
exit 1 · ok: false · passed: 0 · failed: 5 · meanScore: 100
every case: score 100 · grade A · valid true · generationError "model unavailable"
```

`meanScore` is the first number a human scanning that report reads, and it read perfect precisely when the model under test produced nothing.

**What was NOT wrong: `passed`.** It carries its own guard (`!generationError && …`), so the failed cases were reported as failed and `ok` was `false` throughout. A reader who cross-read `ok`/`passed` was safe; a reader who checked the mean and moved on got exactly the wrong impression. That is the whole defect, and nothing about `passed`, `ok`, `total`, `failed` or the exit code changes here.

The repair is the verdict the sibling failure path already used. A generator that *returns* a value nobody can walk was already scored `0 / F / valid: false`, with the reason written into the module: a stack that cannot be walked is not an empty stack, and `valid: true` for one that was never parsed is simply false. A stack that was never produced is not an empty stack either — so both now answer the same:

```json
{ "id": "invoice_with_line_items",
  "generationError": "model unavailable",
  "passed": false,
  "score": { "score": 0, "grade": "F", "valid": false } }
```

and the run above now reports `meanScore: 0`.

`meanScore`'s denominator is unchanged and is now stated in the payload's own documentation: the mean is over every case **attempted**, so a failed case contributes its 0 and is counted. The alternative — averaging only over cases that could be scored — is a different metric that would report the quality of the generations that arrived while staying silent about how many never did; a `meanScore` that switched denominators without saying so would be a worse defect than the one being fixed.

No key is added to or removed from the `--json` payload, and nothing a generator can return is newly accepted or rejected: an off-shape stack is still a **scored** case whose schema errors are why it fails, never a generation error.

---
'@objectstack/spec': patch
---

Correct the `permissions` alias table's justification for `hosts`, and pin the two aliases nothing measured.

`PluginPermissionsSchema` (`kernel/manifest.zod.ts`) curates three aliases — `filesystem` and `paths` point at `fs`, `hosts` points at `network`. The block's only comment said edit distance cannot reach any of them, and it sat directly above all three. That is true of the two `fs` entries and false of `hosts`.

The fallback budget is `Math.max(2, Math.floor(key.length / 3))` (`shared/suggestions.zod.ts`), so a 5-character key gets 2, and `hosts` differs from the declared `hooks` by exactly 2. Measured against the real `findClosestMatches` with the alias table out of the picture: `filesystem` and `paths` return nothing, `hosts` returns `hooks`. So without the alias an author writing `hosts` is answered ``Did you mean `hosts` → `hooks`?`` — pointed at lifecycle hooks on the one block that also grants network access.

The alias is therefore better justified than the comment claimed: it overrules a confident wrong suggestion rather than filling a silent gap. Only the justification moves — the alias stays, the declared keys, the strictness and the union are untouched, and no message an author reads changes.

`hosts` is also the only one of the three whose absence would be invisible, since it is the only one that changes a live suggestion, so `manifest-unknown-keys.test.ts` now pins both it and `paths` alongside the `filesystem` pin that was already there, asserting the offending key and the rename — and, for `hosts`, that `hooks` is not what comes back.

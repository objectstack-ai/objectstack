---
"@objectstack/lint": patch
"@objectstack/spec": patch
---

fix(lint): script-node retired-key diagnostic no longer says "rewrite it" (#7030)

`validate-expressions`'s lint diagnostic for a `script` node carrying a retired
dispatch key (`config.actionType` / `template` / `recipients` / `variables` /
`script`, retired in `@objectstack/spec` 17, #4343) closed with `Run \`os
migrate meta --from 16\` to rewrite it automatically.` For the
`template`/`recipients`/`variables`/`script` branches the value is **deleted**,
not rewritten into anything, so "rewrite **it**" named the wrong antecedent —
the same false-antecedent shape #6856 (route D, maintainer-ruled) already swept
out of every `packages/spec/src` tombstone. This was the one live site the
sweep's scan surface (`packages/spec/src` only) could not see.

The sentence now reads `Run \`os migrate meta --from 16\` to rewrite existing
sources automatically.` — naming a property of the TOOL (it rewrites your
source files), never the retired key's fate, which the message body already
states per branch. Message copy only: the diagnostic still fires on the same
inputs, at the same severity, with the same `#4343` / per-key / replacement
guidance untouched.

`packages/spec/src/shared/retired-key-migrate-sentence.test.ts` — the #6856
class pin — is widened to scan `packages/lint/src` alongside `packages/spec/src`
so this sentence cannot drift from the house form again, in either package.
That widening is test-only (no `@objectstack/spec` runtime code changed);
listed here only because the pin's own file lives inside `packages/spec`.

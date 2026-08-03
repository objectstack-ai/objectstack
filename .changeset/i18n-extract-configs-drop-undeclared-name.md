---
---

chore(i18n): drop the undeclared `name:` key from all nine `scripts/i18n-extract.config.ts`

Releases nothing — build-time-only extract fixtures (`scripts/` is not in any
package's published `files`), no runtime or published behaviour changes.

Every one of the nine extract configs opened its `defineStack({ … })` with a
`name:` that the stack schema does not declare, so `ObjectStackDefinitionSchema`
dropped the value at load and the #4167 unknown-stack-key lint reported it —
once per package, on every `pnpm check:i18n` run, in a run that was otherwise
fully green:

```
defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load — did you mean 'pages'?
```

The lint was right and the configs were wrong: nothing has ever read a stack's
top-level `name` — `os i18n extract` receives the *parsed* `defineStack` result,
from which the key is already gone — so the nine values were inert. The fix is
at the producer (#4736 decision A: delete the nine keys), not a new authorable
key in `packages/spec` to accommodate one typo copied nine times.

Extraction output is unchanged: after the deletion a full
`node scripts/check-i18n-bundles.mjs --write` regenerates all 40 bundles across
the nine packages with a byte-identical result, and `pnpm check:i18n` stays
green — now without the warning.

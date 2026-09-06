---
"@objectstack/objectql": minor
---

`ReadonlyFieldRejectedError`'s error `code` is now an importable constant.

The strict-readonly refusal — thrown by `engine.update` and `engine.insert` when `options.strictReadonlyWrites` is set and the payload carried caller-supplied fields the engine would have stripped — already told readers to identify it by `code`. `content/docs/kernel/contracts/data-engine.mdx` says so in its own words: *"Catch it by `code`, not `instanceof`, and read `drops` for the per-reason breakdown"*. Until now the code was an inline string literal with nothing to import, so the only way to FOLLOW that published instruction was to re-spell `'ERR_READONLY_FIELD_REJECTED'` in your own package — which acquires a `check:error-code-provenance` stamp site there and can then drift from what the engine throws with no compile error to say so.

One new export from `@objectstack/objectql`:

- `READONLY_FIELD_REJECTED_CODE` — `ReadonlyFieldRejectedError`'s ADR-0112 `code`.

**Why `code` and not `instanceof`.** This package declares both realms in its own `exports` (`import` reaches `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding the other realm's copy of the class gets `instanceof` === false — measured, and silent. A `code` compare is the check that survives crossing that boundary, which is exactly what the documentation has been telling readers to do.

**Nothing about the wire changed.** The constant holds text byte-identical to the literal it replaces; the refusal throws the same `code` and the same message as before. Consumers that spell the string themselves keep working unchanged — this adds an affordance, it removes nothing.

**`ReadonlyFieldRejectedError` itself was already exported and stays exported.** Unlike the classes converted alongside it on this sweep, both routes are published here, so the class and the constant must name the same refusal; a test pins that they do.

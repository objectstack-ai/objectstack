---
"@objectstack/objectql": minor
---

`ValidationError` publishes its error `code` as an importable constant — the last row of #16159's census.

`content/docs/kernel/contracts/data-engine.mdx` teaches the convention: catch an engine refusal *by `code`, not `instanceof`*. Following it for record validation meant re-spelling `'VALIDATION_FAILED'` in your own package, which acquires a `check:error-code-provenance` stamp site there and can then drift from what the engine throws with no compile error to say so.

One new export from `@objectstack/objectql`:

- `VALIDATION_FAILED_CODE` — `ValidationError`'s ADR-0112 `code`. Thrown by `validateRecord` when an insert/update payload violates the object's own field metadata, carrying the per-field breakdown on `fields[]`. **Additive widening, `minor`.**

**This row's consumer-side drift is the widest on the card, and worth stating precisely rather than as a slogan.** `'VALIDATION_FAILED'` is re-authored as an inline literal at **148 non-test sites across 33 files** in this repo — but the honest reading of that number is that the large majority are **independent producers** minting their own house-code envelope (`@objectstack/rest`'s response bodies, `plugin-approvals`' `VALIDATION_FAILED: …` message-prefix convention, `plugin-sharing`'s locally-declared `SharingCriteriaValidationError`, `@objectstack/metadata-protocol`'s own class whose docblock calls the code *"this package's own house code"*). Those are not consumers of this class and nothing about them changes.

The sites this export actually serves are the **recognizers**, and there are four: `packages/types/src/validation-failure.ts` and `packages/rest/src/error-response.ts` both test `code === 'VALIDATION_FAILED' || name === 'ValidationError'`, `packages/rest/src/error-response.ts` tests the wire body's `code` a second time, and `packages/plugins/plugin-auth/src/objectql-adapter.ts` does the same to map an engine refusal onto a `better-auth` `APIError`. Each holds its own copy of the string. **No consumer is rewired here** — the card's scope is the producer-side importable constant, and re-pointing another package's recognizer is a cross-package coupling this card never asked for.

**Why `code` and not `instanceof`.** This package declares both realms in its own `exports` (`import` reaches `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding the other realm's copy of `ValidationError` gets `instanceof` === false — measured, and silent. A `code` compare is the check that survives that boundary.

**Nothing about the wire changed.** The constant holds text byte-identical to the literal it replaces; the refusal throws the same `code` and the same message as before. Consumers that spell the string themselves keep working unchanged — this adds an affordance and removes nothing.

**It does not converge `VALIDATION_FAILED` with `VALIDATION_ERROR`.** `EMPTY_CREDENTIAL_REFUSAL_CODE` in the same package is `'VALIDATION_ERROR'`; #16159 explicitly leaves *"whether they should converge"* unruled, and publishing the current spelling keeps that decision exactly as open as it was — a convergence is a breaking rename of a registered wire code either way. A pin test asserts the two are still two, so a future ruling has to argue for itself rather than arrive as a side effect.

**`ValidationError` was already exported and stays exported.** The constant joins it on the batteries barrel only, matching every existing `*_CODE` in this package; the class is *also* on the lean `./core` entry, so this adds one more instance to the asymmetry #16260 owns — deliberately not decided here.

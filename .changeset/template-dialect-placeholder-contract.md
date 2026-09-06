---
"@objectstack/spec": patch
---

`TemplateExpressionInputSchema` documents what the `template` dialect actually accepts, instead of illustrating it with a grammar it does not judge.

The docblock introduced the dialect as "anything with `{{var}}` interpolation". Nothing in the schema enforces that: `TemplateExpressionInputSchema` judges the dialect tag and non-emptiness and nothing else, and the same docblock already said so one clause later. Read as a declaration, it made every single-brace `titleFormat` value in the wild look like it was crossing a gate. There is no gate.

The corrected prose states where the placeholder grammar really lives — with the renderer that consumes the slot — and that the two spellings in circulation are not interchangeable everywhere:

- `{{var}}` is the canonical form and the only one the registered `template` engine reads (`@objectstack/formula`'s `templateEngine`); the messaging renderer, the email plugin and the i18n adapters match it alone and leave a `{var}` in their output verbatim.
- `titleFormat` is the exception: its renderers accept `{{var}}` and `{var}` as equivalent, normalizing the double form down to the single one before substituting. Single-brace `titleFormat` values are legal by construction, not a grammar the schema failed to enforce.

`titleFormat`'s `.describe()` says the same thing at the slot. Documentation only — the schema's judging logic, its accept-set and its exports are untouched, so nothing an author can write changes meaning. Both strings publish (`dist/*.d.ts` and the bundled `.describe()`), which is why this is a `patch` rather than a `skip-changeset`.

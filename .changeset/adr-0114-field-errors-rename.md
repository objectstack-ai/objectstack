---
"@objectstack/spec": major
---

feat(spec)!: `EnhancedApiError.fieldErrors` → `fields`, tombstoned (ADR-0114 D4, #3977)

Completes ADR-0114 D4, which the field-level catalog PR (#4035) decided but left
unexecuted because retiring an authorable key needs its own sequence.

**FROM → TO:** `EnhancedApiError.fieldErrors` → `EnhancedApiError.fields`. The array
and its element shape are unchanged — only the property name.

The wire has always carried `fields`: the validators, import coercion,
`validation-failure.ts`, `@objectstack/client` and the console's field-error
extractor all say `fields`. `fieldErrors` was declared and emitted by nobody, so
anyone reading `error.fieldErrors` was reading a field no server sent — ADR-0078's
silently-inert declaration, sitting on the error envelope.

**The old key is tombstoned, not deleted.** `EnhancedApiErrorSchema` is not
`.strict()`, so a plain removal would let a producer still writing `fieldErrors`
parse clean and lose the per-field detail — a validation failure that mentions no
field. Writing it now fails with the rename prescription instead
(`retiredKey()`, ADR-0104).

**Migration:** read `error.fields`. There is nothing to run: this is a response
envelope, so no stack, example or template carries the key and `os migrate meta`
has no source to rewrite. The change is recorded as a semantic chain entry
(`enhanced-api-error-field-errors-renamed`) with its reason and acceptance
criterion, which is what reaches the generated upgrade guide and the
`spec_changes` MCP tool.

---
"@objectstack/spec": minor
---

fix(field): fold the deprecated `conditionalRequired` alias into `requiredWhen` and drop it from the parsed output (#3754)

Second instance of the alias-drift shape #3713/#3742 fixed for `action.execute`.
`requiredWhen` is canonical and `conditionalRequired` is its documented deprecated
alias, but `FieldSchema` had **no canonicalization at all** — both keys stayed live
in the parsed output, so every consumer had to re-implement the precedence. That is
exactly the condition that produced #3713, where the server kept `target` while
objectui's renderer preferred the alias and one button ran two different scripts.

Worse, the alias surviving parse was **test-pinned**, including a case literally
named *"requiredWhen and its alias conditionalRequired can coexist"* — the inverse
of the contract #3742 had just established one field over.

`FieldSchema` now lowers `conditionalRequired` into `requiredWhen` at parse time and
removes the alias from its output; `requiredWhen` wins when both are declared. The
pinning tests are inverted accordingly, and a new case asserts the alias is gone
from a field parsed through `ObjectSchema` — the path a renderer actually receives,
not just a bare `FieldSchema.parse()`.

No live bug is being fixed here: every reader we can see already prefers the
canonical key (`rule-validator.ts` reads `requiredWhen ?? conditionalRequired`). The
point is that nothing in the contract *made* that right. This is hardening — it
removes the chance rather than a defect.

`objectql`'s `requiredWhen ?? conditionalRequired` fallback is kept on purpose:
`evaluateValidationRules` is also handed raw, unparsed field definitions, which still
carry the alias.

**Authoring is unchanged.** `conditionalRequired` is still accepted on input, still
lowered, still listed in the reference docs and JSON Schema. Nothing to migrate in
app metadata.

**Consumers of the parsed metadata** must read the canonical slot:

- FROM `parsedField.conditionalRequired` → TO `parsedField.requiredWhen`
- One-line fix: `field.conditionalRequired || field.requiredWhen` becomes
  `field.requiredWhen`

`z.infer<typeof FieldSchema>` no longer carries `conditionalRequired`, so a stale
reader fails to compile rather than silently reading `undefined`. A new
`FieldParseInput` (`z.input<typeof FieldSchema>`) names the author-facing shape that
still accepts the alias — distinct from the pre-existing `FieldInput` factory-helper
type, which is `Partial<Field>` and unrelated.

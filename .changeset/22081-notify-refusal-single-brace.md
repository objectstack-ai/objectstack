---
"@objectstack/spec": patch
---

A notify flow node's `title` / `message` refusal now prescribes `'{record.name}'`, the single-brace spelling the notify executor reads. It used to prescribe the shared template sentence's `'{{record.name}}'`, which the build's `flow-double-brace-interpolation` rule then flagged on the same node and the notify renderer sent inside a stray pair of braces.

Clause-②: no

- Both slots take the same input as before: a bare, non-blank string or a `{ dialect: 'template', source }` envelope. Every value that parsed still parses, every value that was refused is still refused, with the same `invalid_union` code at the same path. Only the sentence changes.
- A blank bare string, a number, a non-template envelope and the like at `title` or `message` are refused with a sentence that names the key, prescribes `'{record.name}'` or `{ dialect: 'template', source: '{record.name}' }`, and says why: the notify executor interpolates single-brace `{token}` placeholders, and a doubled brace keeps its outer braces in the sent text. The branch issue that `formatZodIssue` and the API error mapper print beneath it carries the same sentence, so no `{{…}}` prescription reaches the author on these two keys. The build's flow judge (`FlowSchema`, flow registration, `os validate`) quotes the new sentence.
- Every other template slot keeps its sentence, which still prescribes `'{{record.name}}'`. That covers `titleFormat`, the prompt template's `system` / `user`, and any slot typed `TemplateExpressionInputSchema`. `TYPED_EXPRESSION_SOURCE_REQUIRED.template` and `TYPED_EXPRESSION_DIALECT_ONLY.template` are unchanged.
- The `tmpl` docblock no longer calls the envelope "Mustache" or shows only `{{record.x}}`. It now says which renderers read which braces: `{{record.x}}` for the formula template engine and the messaging, email and i18n renderers, `{record.x}` for a notify node's `title` / `message`, and either for `titleFormat`. The `TemplateExpressionInputSchema` docblock lists the notify slots the same way, and the generated expression reference page says a template slot's fix is written in the spelling its renderer reads.
- No export is added, removed or renamed, and no type changes. The notify slots take the same input as `TemplateExpressionInputSchema` from a constructor that stays internal to the package.

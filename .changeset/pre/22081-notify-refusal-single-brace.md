---
"@objectstack/spec": patch
---

A notify flow node's `title` / `message` refusal now names the key and prescribes `'{{ record.name }}'`, the `{{ }}` hole the notify executor renders. It used to answer with the shared template sentence, which names no key.

Clause-②: no

- Both slots take the same input as before: a bare, non-blank string or a `{ dialect: 'template', source }` envelope. Every value that parsed still parses, every value that was refused is still refused, with the same `invalid_union` code at the same path. Only the sentence changes.
- A blank bare string, a number, a non-template envelope and the like at `title` or `message` are refused with a sentence that names the key, prescribes `'{{ record.name }}'` or `{ dialect: 'template', source: '{{ record.name }}' }`, and says why: the notify executor renders `{{ }}` template holes, and a single-brace token is not one. The branch issue that `formatZodIssue` and the API error mapper print beneath it carries the same sentence. The build's flow judge (`FlowSchema`, flow registration, `os validate`) quotes the new sentence.
- Every other template slot keeps its sentence, which still prescribes `'{{record.name}}'`. That covers `titleFormat`, the prompt template's `system` / `user`, and any slot typed `TemplateExpressionInputSchema`. `TYPED_EXPRESSION_SOURCE_REQUIRED.template` and `TYPED_EXPRESSION_DIALECT_ONLY.template` are unchanged.
- The `tmpl` docblock no longer calls the envelope "Mustache" or shows only `{{record.x}}`. It now says which renderers read which braces: `{{record.x}}` for the formula template engine, the messaging, email and i18n renderers and a notify node's `title` / `message`, and either for `titleFormat`. The `TemplateExpressionInputSchema` docblock lists the notify slots the same way, and the generated expression reference page says a template slot's fix is written in the spelling its renderer reads.
- No export is added, removed or renamed, and no type changes. The notify slots take the same input as `TemplateExpressionInputSchema` from a constructor that stays internal to the package.

---
"@objectstack/spec": patch
---

`functional-completeness`'s published doc block now anchors its `record-validator.ts` citations on a SYMBOL and a verbatim snippet instead of a line number.

The module doc for the functional-completeness predicate is emitted verbatim into `dist/kernel/index.d.ts`, so the citations that justify its rules ship to consumers. Three of them cited `packages/objectql/src/validation/record-validator.ts` by line — `:452` for the `select`/`radio` rule and `:471` for the `multiselect` NON-rule — and the validator has moved twice since those numbers were written. Both landed hundreds of lines away, on unrelated prose inside a comment block, which is the failure mode a `path:NNN` anchor has by construction: the line it lands on still looks like plausible code, so nothing reads as broken.

Each citation now names the enclosing function `validateOne` and quotes the runtime text it relies on — `allowed.length > 0 && !allowed.includes(String(value))` for the empty-option-list gate, `// free-form (tags without options)` for the NON-rule. A snippet anchor cannot rot silently the way a line number does: it either still matches the file or it does not.

No rule, severity, accept set or exported symbol changes, and the pinned NON-rule (`multiselect` without `options` is deliberately not flagged) is untouched — the runtime text it quotes is unchanged and still present. Documentation only.

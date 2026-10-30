---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the formula editor inserts a field by its label, leads a CEL syntax fault with a plain sentence, and keeps a new finding in view

Clause-②: no
Metadata-protocol: none

The Studio CEL editor (a formula field's "Formula (CEL)", and the other CEL editors that share it) gains three authoring aids:

- **Insert field.** The formula editor has an **Insert field** picker listing the object's other fields by the label the author knows them by (with the machine name beside it), searchable by either. Choosing one inserts its CEL reference (`record.` followed by the field's name, e.g. `record.estimated_hours`) at the caret, replacing any selected text. The field being edited is not offered.
- **A syntax fault in plain words.** When `@objectstack/formula` refuses an expression with its catch-all CEL code (`invalid-cel`: a missing operand, an unclosed bracket or string, a value that does not fit its operator), the editor leads with a plain sentence and then shows the engine's own fault with its source excerpt in monospace, so the `^` mark lines up under the spot it points to. Refusals that carry their own prescription (an unknown field with its "did you mean", an unknown function, a template brace) keep their message. The producer's message is unchanged for every other reader (the Save gate, the client spec check, the server-verdict comparison).
- **The finding stays in view.** A finding that appears while the author types is scrolled into view, so in a scrolling inspector it no longer lands below the visible area behind the **Remove** footer.

`@object-ui/i18n` gains `perm.cel.insertField`, `perm.cel.searchFields`, `perm.cel.noMatchingFields` and `engine.celLint.invalidCel` in the studio namespace (en, zh).

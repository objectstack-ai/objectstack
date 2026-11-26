---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(studio): the CEL condition builder offers membership, not equals, on a list field

Clause-②: no
Metadata-protocol: none

On a field that holds a list (a `multiselect`, `checkboxes` or `tags` field, or a `select` / `lookup` / `user` field declared `multiple: true`), Studio's condition builder (hook, validation-rule, action-visibility, page-block and flow entry conditions) offered equals / not equals and the ordering operators. CEL compares the whole list with one value there, so `record.labels == 'frontend'` was false for every record (and `!=` true for every record), and the author got no signal.

Such a field is now offered what the list toolbar's filter builder offers it: contains, does not contain, is empty and is not empty. Contains writes `S != null && V in S` and does not contain writes `S == null || !(V in S)`, the same spelling a flow edge's condition rows write; both are null-safe. A row moved onto a list field leaves equals for contains, and a row moved off one leaves membership for equals. A stored condition that compares a list field with `==` / `!=` now opens in the expression editor exactly as stored, never rewritten. A single-value field is offered what it was before.

New locale key: `engine.inspector.condition.op.notContains` in the studio catalogue (en, zh). No props or exports change.
